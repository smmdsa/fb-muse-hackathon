// Profile page. Same-origin API. Token lives in localStorage only.

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "aw_token";
const HANDLE_KEY = "aw_handle";

let token = localStorage.getItem(TOKEN_KEY) || "";
let agentId = "";
let latestVersion = "";

function headers() {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function shieldFor(tier) {
  return `./assets/shields/${String(tier || "prototype").toLowerCase()}.png`;
}

function show(el, on) {
  el.hidden = !on;
}

async function refresh() {
  if (!token || !agentId) return;
  const r = await call("GET", `/v1/agents/${agentId}/dashboard`);
  if (r.status !== 200) return;
  const d = r.data;
  $("hero-name").textContent = d.agent.name || "Unnamed hero";
  $("hero-concept").textContent = d.agent.concept || "no concept yet";
  if (d.agent.portraitUrl) {
    $("hero-img").src = d.agent.portraitUrl;
    show($("hero-img"), true);
  }
  $("hero-shield").src = shieldFor(d.leader.tier);
  show($("hero-shield"), true);
  $("hero-ap").textContent = `${d.leader.ap} AP — ${d.leader.tier}${d.leader.division ? " " + d.leader.division : ""}`;
  $("hero-ac").textContent = `${d.leader.ac} AC in the wallet`;
  renderDash(d);
}

function renderDash(d) {
  const box = $("dash");
  box.textContent = "";
  if (!d.versions.length) {
    box.innerHTML = "<p class='sub'>No versions yet. Compile a prompt to mint chips.</p>";
    return;
  }
  for (const v of d.versions.slice().reverse()) {
    const card = document.createElement("div");
    card.className = "ver";
    const head = document.createElement("p");
    head.className = "ver-head";
    const prov = document.createElement("span");
    prov.className = "pill" + (v.isMock ? "" : " live");
    prov.textContent = v.isMock ? "mock" : v.provider;
    head.textContent = `${v.versionId.slice(0, 14)}… — ${v.fights} fights, ${v.wins} wins, ${(v.winRate * 100).toFixed(0)}%, ${v.avgTicks} avg ticks `;
    head.appendChild(prov);
    card.appendChild(head);
    const table = document.createElement("table");
    table.className = "chips";
    const top = document.createElement("tr");
    for (const h of ["chip", "move", "fire", "triggers"]) {
      const th = document.createElement("th");
      th.textContent = h;
      top.appendChild(th);
    }
    table.appendChild(top);
    for (const c of v.chips) {
      const tr = document.createElement("tr");
      for (const cell of [c.id, c.move, c.fire ? "yes" : "no", String(c.triggers)]) {
        const td = document.createElement("td");
        td.textContent = cell;
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    card.appendChild(table);
  }
  show($("dash-card"), true);
}

async function boot() {
  const handle = localStorage.getItem(HANDLE_KEY) || "";
  if (handle) $("handle").value = handle;
  if (!token) return;
  $("pill-who").textContent = localStorage.getItem(HANDLE_KEY) || "signed in";
  const me = await call("GET", "/v1/me");
  if (me.status !== 200) {
    token = "";
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  show($("login-card"), false);
  show($("hero-card"), true);
  show($("train-card"), true);
  if (me.data.agent) {
    agentId = me.data.agent.id;
    show($("breed-row"), false);
    await refresh();
  } else {
    show($("breed-row"), true);
    show($("breed-msg"), true);
  }
}

$("login-btn").addEventListener("click", async () => {
  const handle = $("handle").value.trim();
  if (!handle) {
    $("login-msg").textContent = "Type a handle first.";
    return;
  }
  $("login-msg").textContent = "Signing in…";
  const r = await call("POST", "/v1/auth/session", { handle });
  if (r.status !== 200) {
    $("login-msg").textContent = "Sign in failed. Run the API and retry.";
    return;
  }
  token = r.data.token;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(HANDLE_KEY, handle);
  await boot();
});

$("breed-btn").addEventListener("click", async () => {
  $("breed-msg").textContent = "Breeding… the image model paints the portrait now.";
  const r = await call("POST", "/v1/agents", {
    name: $("hero-name-in").value.trim(),
    concept: $("hero-concept-in").value.trim(),
  });
  if (r.status !== 201) {
    $("breed-msg").textContent = `Breeding failed: ${r.data.error || r.status}.`;
    return;
  }
  agentId = r.data.agentId;
  show($("breed-row"), false);
  $("breed-msg").textContent = r.data.portraitUrl
    ? "Hero bred with a portrait."
    : "Hero bred faceless — the server holds no image key.";
  await refresh();
});

$("compile-btn").addEventListener("click", async () => {
  const prompt = $("prompt").value.trim();
  if (!prompt) {
    $("train-msg").textContent = "Type a prompt first.";
    return;
  }
  $("train-msg").textContent = "Compiling…";
  $("fight-btn").disabled = true;
  const r = await call("POST", `/v1/agents/${agentId}/policies/compile`, { prompt });
  if (r.status !== 201) {
    $("train-msg").textContent = `Compile failed: ${(r.data.errors || [r.data.error]).join("; ")}`;
    return;
  }
  latestVersion = r.data.versionId;
  $("train-msg").textContent = `Version minted by ${r.data.isMock ? "mock" : r.data.provider}. Run a training fight.`;
  $("fight-btn").disabled = false;
  await refresh();
});

$("fight-btn").addEventListener("click", async () => {
  if (!latestVersion) return;
  $("train-msg").textContent = "Fighting…";
  $("fight-btn").disabled = true;
  const r = await call("POST", "/v1/matches/training", { versionId: latestVersion, seed: `p-${Date.now().toString(36)}` });
  if (r.status !== 201) {
    $("train-msg").textContent = `Fight failed: ${r.data.error || r.status}.`;
    return;
  }
  $("train-msg").textContent = `${r.data.winner} wins in ${r.data.ticks} ticks. Dashboard updated.`;
  await refresh();
});

boot();
