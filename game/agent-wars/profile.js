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

// Deterministic fallback glyph. One hue per hero, same navy field.
function silhouetteFor(id) {
  let h = 0;
  for (let i = 0; i < String(id).length; i += 1) h = (Math.imul(h, 31) + String(id).charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'>"
    + "<rect width='96' height='96' fill='#101923'/>"
    + "<rect x='38' y='14' width='20' height='14' fill='#8a94a6'/>"
    + `<rect x='42' y='18' width='12' height='5' fill='hsl(${hue},90%,60%)'/>`
    + "<rect x='30' y='32' width='36' height='30' fill='#5b6577'/>"
    + `<rect x='42' y='38' width='12' height='8' fill='hsl(${hue},90%,60%)'/>`
    + "<rect x='22' y='34' width='6' height='22' fill='#8a94a6'/>"
    + "<rect x='68' y='34' width='6' height='22' fill='#8a94a6'/>"
    + "<rect x='34' y='64' width='10' height='20' fill='#8a94a6'/>"
    + "<rect x='52' y='64' width='10' height='20' fill='#8a94a6'/>"
    + "</svg>";
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
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
    $("hero-art-status").textContent = "Portrait ready — house style locked.";
  } else {
    $("hero-img").src = silhouetteFor(d.agent.id);
    show($("hero-img"), true);
    $("hero-art-status").textContent = d.agent.portraitStatus === "failed"
      ? "Portrait paint failed. Retry below — the hero still fights."
      : "Faceless hero — the server holds no image key yet. The hero still fights.";
  }
  show($("hero-art-status"), true);
  show($("retry-btn"), !d.agent.portraitUrl);
  $("hero-shield").src = shieldFor(d.leader.tier);
  show($("hero-shield"), true);
  $("hero-ap").textContent = `${d.leader.ap} AP — ${d.leader.tier}${d.leader.division ? " " + d.leader.division : ""}`;
  $("hero-ac").textContent = `${d.leader.ac} AC in the wallet`;
  const mins = Math.ceil(d.energy.nextRegenMs / 60000);
  $("hero-energy").textContent = d.energy.energy >= d.energy.energyMax
    ? `energy ${d.energy.energy}/${d.energy.energyMax} — full`
    : `energy ${d.energy.energy}/${d.energy.energyMax} — +1 in ${mins || 1} min`;
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
    const dna = document.createElement("p");
    dna.className = "sub";
    const traits = v.dna || {};
    dna.textContent = ["aggression", "evasion", "preferredDistance", "energyConservation"]
      .map((k) => `${k} ${traits[k] ?? "—"}`)
      .join(" · ");
    card.appendChild(dna);
    if (v.versionId !== d.agent.activeVersionId) {
      const fit = document.createElement("button");
      fit.className = "btn-ghost";
      fit.type = "button";
      fit.textContent = "Install this version";
      fit.addEventListener("click", async () => {
        const r = await call("POST", `/v1/agents/${d.agent.id}/policies/install`, { versionId: v.versionId });
        $("train-msg").textContent = r.status === 200
          ? "Version installed. The queue takes the active version."
          : `Install failed: ${r.data.error || r.status}.`;
        await refresh();
      });
      card.appendChild(fit);
    }
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
  renderHist(d);
}

function renderHist(d) {
  const box = $("hist");
  box.textContent = "";
  const rows = d.history || [];
  if (!rows.length) {
    box.innerHTML = "<p class='sub'>No fights yet — queue from the arena.</p>";
  }
  for (const h of rows) {
    const p = document.createElement("p");
    p.className = "sub";
    const econ = h.rated
      ? `AP ${h.myDelta >= 0 ? "+" : ""}${h.myDelta} · ${h.myPaid} AC`
      : `${h.myPaid} AC · unrated`;
    const foe = String(h.foe || "").startsWith("bot:") ? `sparring ${h.foe}` : `vs ${h.foe}`;
    p.textContent = `${h.winner} wins in ${h.ticks} ticks ${foe} — ${econ} `;
    const a = document.createElement("a");
    a.href = `./index.html?replay=${h.matchId}`;
    a.textContent = "replay";
    p.appendChild(a);
    box.appendChild(p);
  }
  show($("hist-card"), true);
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
    : `Hero bred ${r.data.portraitStatus} — art can retry later, fights start now.`;
  await refresh();
});

$("retry-btn").addEventListener("click", async () => {
  if (!agentId) return;
  $("hero-art-status").textContent = "Repainting the portrait…";
  const r = await call("POST", `/v1/agents/${agentId}/portrait/retry`);
  if (r.status !== 200) {
    $("hero-art-status").textContent = `Retry failed: ${r.data.error || r.status}.`;
    return;
  }
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
  $("train-msg").textContent = `Draft minted by ${r.data.isMock ? "mock" : r.data.provider}. Install it below, then queue.`;
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
