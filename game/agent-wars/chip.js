// Chip Lab page. Same-origin API. Token lives in localStorage only.

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

function show(el, on) {
  el.hidden = !on;
}

function shortWhen(when) {
  const flat = (p) => {
    if (!p || typeof p !== "object") return "?";
    if (p.operand) return `${p.operand} ${p.op} ${p.value}`;
    if (Array.isArray(p.all)) return `all(${p.all.map(flat).join("; ")})`;
    if (Array.isArray(p.any)) return `any(${p.any.map(flat).join("; ")})`;
    if (p.not) return `not ${flat(p.not)}`;
    return "?";
  };
  const s = flat(when);
  return s.length > 48 ? `${s.slice(0, 47)}…` : s;
}

function versionTitle(v) {
  return v.label ? `${v.label} (${v.versionId.slice(0, 8)}…)` : `${v.versionId.slice(0, 14)}…`;
}

async function refresh() {
  if (!token || !agentId) return;
  const r = await call("GET", `/v1/agents/${agentId}/dashboard`);
  if (r.status !== 200) {
    $("train-msg").textContent = `Dashboard unavailable: ${r.data.error || r.status}. Retry in a bit.`;
    return;
  }
  renderCore(r.data);
  renderDash(r.data);
}

function renderCore(d) {
  const box = $("core");
  box.textContent = "";
  const versions = Array.isArray(d.versions) ? d.versions : [];
  const active = versions.find((v) => v.versionId === d.agent.activeVersionId);
  if (!active) {
    const p = document.createElement("p");
    p.className = "sub";
    p.textContent = versions.length
      ? "No chip installed — install one from the library below."
      : "No chips yet — compile your first battle plan above.";
    box.appendChild(p);
  } else {
    const name = document.createElement("p");
    name.className = "hero-name";
    name.textContent = versionTitle(active);
    const stats = document.createElement("p");
    stats.className = "sub";
    stats.textContent = `${active.fights} fights · ${active.wins} wins · ${(active.winRate * 100).toFixed(0)}% · ${active.avgTicks} avg ticks`;
    const dna = document.createElement("p");
    dna.className = "sub";
    const traits = active.dna || {};
    dna.textContent = ["aggression", "evasion", "preferredDistance", "energyConservation"]
      .map((k) => `${k} ${traits[k] ?? "—"}`)
      .join(" · ");
    box.append(name, stats, dna);
  }
  show($("core-card"), true);
}

async function renderDash(d) {
  const box = $("dash");
  box.textContent = "";
  const versions = Array.isArray(d.versions) ? d.versions : null;
  const count = document.createElement("p");
  count.className = "sub";
  if (!versions) {
    count.textContent = `Dashboard arrived without versions (keys: ${Object.keys(d || {}).join(", ")}). Reload the page.`;
    box.appendChild(count);
    show($("dash-card"), true);
    return;
  }
  count.textContent = `Library: ${versions.length} version(s) on file.`;
  box.appendChild(count);
  if (!versions.length) {
    const empty = document.createElement("p");
    empty.className = "sub";
    empty.textContent = "No versions yet. Compile a prompt to mint chips.";
    box.appendChild(empty);
    show($("dash-card"), true);
    return;
  }
  for (const v of versions.slice().reverse()) {
    try {
      box.appendChild(paintVersion(d, v));
    } catch (err) {
      const bad = document.createElement("p");
      bad.className = "sub";
      bad.textContent = `Card ${v && v.versionId ? v.versionId : "?"} failed to paint: ${err instanceof Error ? err.message : String(err)}`;
      box.appendChild(bad);
    }
  }
  show($("dash-card"), true);
}

// One card paints alone. A sick card never kills its siblings.
function paintVersion(d, v) {
    const card = document.createElement("div");
    card.className = "ver";
    const head = document.createElement("p");
    head.className = "ver-head";
    const prov = document.createElement("span");
    prov.className = "pill" + (v.isMock ? "" : " live");
    prov.textContent = v.isMock ? "mock" : v.provider;
    head.textContent = `${versionTitle(v)} — ${v.fights} fights, ${v.wins} wins, ${(v.winRate * 100).toFixed(0)}%, ${v.avgTicks} avg ticks `;
    head.appendChild(prov);
    card.appendChild(head);
    if (v.corrupt) {
      const bad = document.createElement("p");
      bad.className = "sub";
      bad.textContent = "Unreadable draft — its rules never saved right. Delete it below and compile again.";
      card.appendChild(bad);
    }
    if (!v.corrupt) {
      const dna = document.createElement("p");
      dna.className = "sub";
      const traits = v.dna || {};
      dna.textContent = ["aggression", "evasion", "preferredDistance", "energyConservation"]
        .map((k) => `${k} ${traits[k] ?? "—"}`)
        .join(" · ");
      card.appendChild(dna);
    }
    if (v.versionId !== d.agent.activeVersionId && !v.corrupt) {
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
    if (v.versionId !== d.agent.activeVersionId) {
      const drop = document.createElement("button");
      drop.className = "btn-ghost";
      drop.type = "button";
      drop.textContent = "Delete draft";
      drop.addEventListener("click", async () => {
        const r = await call("DELETE", `/v1/agents/${d.agent.id}/policies/${v.versionId}`);
        $("train-msg").textContent = r.status === 200
          ? "Draft deleted."
          : `Delete failed: ${r.data.error || r.status}.`;
        await refresh();
      });
      card.appendChild(drop);
    }
    const ren = document.createElement("button");
    ren.className = "btn-ghost";
    ren.type = "button";
    ren.textContent = v.label ? "Rename" : "Name it";
    ren.addEventListener("click", () => {
      const wrap = document.createElement("span");
      const inp = document.createElement("input");
      inp.value = v.label || "";
      inp.maxLength = 60;
      inp.setAttribute("aria-label", "Version name");
      const save = document.createElement("button");
      save.className = "btn-ghost";
      save.type = "button";
      save.textContent = "Save";
      save.addEventListener("click", async () => {
        const r = await call("POST", `/v1/agents/${d.agent.id}/policies/${v.versionId}/rename`, { label: inp.value });
        if (r.status !== 200) {
          $("train-msg").textContent = `Rename failed: ${r.data.error || r.status}.`;
          return;
        }
        await refresh();
      });
      wrap.appendChild(inp);
      wrap.appendChild(save);
      card.appendChild(wrap);
    });
    card.appendChild(ren);
    const force = document.createElement("button");
    force.className = "btn-ghost";
    force.type = "button";
    force.textContent = "Force delete";
    let armed = false;
    force.addEventListener("click", async () => {
      if (!armed) {
        armed = true;
        force.textContent = "Sure? Force delete";
        setTimeout(() => {
          armed = false;
          force.textContent = "Force delete";
        }, 5000);
        return;
      }
      const r = await call("POST", `/v1/agents/${d.agent.id}/policies/${v.versionId}/force-delete`);
      $("train-msg").textContent = r.status === 200
        ? (r.data.clearedActive ? "Version force-deleted. Install a version to fight again." : "Version force-deleted.")
        : `Force delete failed: ${r.data.error || r.status}.`;
      await refresh();
    });
    card.appendChild(force);
    const table = document.createElement("table");
    table.className = "chips";
    const top = document.createElement("tr");
    for (const h of ["chip", "when", "move", "fire", "triggers"]) {
      const th = document.createElement("th");
      th.textContent = h;
      top.appendChild(th);
    }
    table.appendChild(top);
    for (const c of v.chips) {
      const tr = document.createElement("tr");
      for (const cell of [c.id, shortWhen(c.when), c.move, c.fire ? "yes" : "no", String(c.triggers)]) {
        const td = document.createElement("td");
        td.textContent = cell;
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    if (!v.corrupt) card.appendChild(table);
    return card;
}

// Counters keep long briefs honest. The cap is 2000, the habit is detail.
for (const [box, count] of [["prompt", "prompt-count"], ["prompt-a", "prompt-a-count"], ["prompt-b", "prompt-b-count"]]) {
  $(box).addEventListener("input", () => {
    $(count).textContent = String($(box).value.length);
  });
}

$("lab-btn").addEventListener("click", async () => {
  if (!agentId) return;
  const promptA = $("prompt-a").value.trim();
  const promptB = $("prompt-b").value.trim();
  const bouts = Math.min(20, Math.max(4, parseInt($("lab-bouts").value, 10) || 10));
  if (!promptA || !promptB) {
    $("lab-msg").textContent = "Two prompts are required.";
    return;
  }
  $("lab-msg").textContent = "Running bouts…";
  $("lab-btn").disabled = true;
  const r = await call("POST", "/v1/lab/ab", { agentId, promptA, promptB, bouts });
  $("lab-btn").disabled = false;
  if (r.status !== 201) {
    $("lab-msg").textContent = `Lab failed: ${r.data.error || r.status}.`;
    return;
  }
  const d = r.data;
  $("lab-msg").textContent = `A ${d.winsA}W ${d.drawsA}D vs benchmark · B ${d.winsB}W ${d.drawsB}D · ${d.verdict}.`;
  const box = $("lab-out");
  box.textContent = "";
  for (const [label, version] of [["Install A", d.versionA], ["Install B", d.versionB]]) {
    const btn = document.createElement("button");
    btn.className = "btn-ghost";
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", async () => {
      await call("POST", `/v1/agents/${agentId}/policies/install`, { versionId: version });
      await refresh();
    });
    box.appendChild(btn);
  }
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
  $("train-msg").textContent = `${r.data.winner} wins in ${r.data.ticks} ticks. Library updated.`;
  await refresh();
});

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
  if (!me.data.agent) {
    $("train-msg").textContent = "Breed a hero in the barracks first — chips need a mind to drive.";
    show($("train-card"), true);
    $("compile-btn").disabled = true;
    return;
  }
  agentId = me.data.agent.id;
  show($("train-card"), true);
  show($("lab-card"), true);
  await refresh();
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

boot();
