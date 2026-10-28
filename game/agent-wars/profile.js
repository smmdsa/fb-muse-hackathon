// Profile page. Same-origin API. Token lives in localStorage only.
// Barracks owns the agent and its career. Chips live in Chip Lab,
// cosmetics live in the Armory.

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "aw_token";
const HANDLE_KEY = "aw_handle";

let token = localStorage.getItem(TOKEN_KEY) || "";
let agentId = "";
let latestDash = null;
let justBred = false;

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

function toastSay(msg) {
  if (typeof window.toast === "function") window.toast(msg);
}

function versionTitle(v) {
  return v.label ? `${v.label} (${v.versionId.slice(0, 8)}…)` : `${v.versionId.slice(0, 14)}…`;
}

// Deterministic fallback glyph. Same navy field, same robot shape, always.
// Equipped skins only shift the palette: ember burns orange, tide runs cold.
const SKIN_TINTS = {
  "skin-ember": { visor: 18, body: "#7a5b4a", limb: "#a08a76" },
  "skin-tide": { visor: 190, body: "#4a6a7a", limb: "#8ab0c0" },
};

function silhouetteFor(id, skin) {
  const tint = SKIN_TINTS[skin] || null;
  let h = 0;
  for (let i = 0; i < String(id).length; i += 1) h = (Math.imul(h, 31) + String(id).charCodeAt(i)) >>> 0;
  const hue = tint ? tint.visor : h % 360;
  const body = tint ? tint.body : "#5b6577";
  const limb = tint ? tint.limb : "#8a94a6";
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'>"
    + "<rect width='96' height='96' fill='#101923'/>"
    + `<rect x='38' y='14' width='20' height='14' fill='${limb}'/>`
    + `<rect x='42' y='18' width='12' height='5' fill='hsl(${hue},90%,60%)'/>`
    + `<rect x='30' y='32' width='36' height='30' fill='${body}'/>`
    + `<rect x='42' y='38' width='12' height='8' fill='hsl(${hue},90%,60%)'/>`
    + `<rect x='22' y='34' width='6' height='22' fill='${limb}'/>`
    + `<rect x='68' y='34' width='6' height='22' fill='${limb}'/>`
    + `<rect x='34' y='64' width='10' height='20' fill='${limb}'/>`
    + `<rect x='52' y='64' width='10' height='20' fill='${limb}'/>`
    + "</svg>";
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function refresh() {
  if (!token || !agentId) return;
  const r = await call("GET", `/v1/agents/${agentId}/dashboard`);
  if (r.status !== 200) {
    toastSay(`Dashboard unavailable: ${r.data.error || r.status}.`);
    return;
  }
  const d = r.data;
  $("hero-name").textContent = d.agent.name || "Unnamed hero";
  $("hero-concept").textContent = d.agent.concept || "no concept yet";
  if (d.agent.portraitUrl) {
    $("hero-img").src = d.agent.portraitUrl;
    show($("hero-img"), true);
    $("hero-art-status").textContent = "Portrait ready — house style locked.";
  } else {
    const arm = await call("GET", "/v1/armory");
    const skin = arm.status === 200 && arm.data.equipped ? arm.data.equipped.skin : null;
    $("hero-img").src = silhouetteFor(d.agent.id, skin);
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
  const versions = d.versions || [];
  const hasActive = Boolean(d.agent && d.agent.activeVersionId);
  markWelcome(Boolean(d.agent), versions.length > 0, hasActive);
  latestDash = d;
  paintBreedState(true);
  paintHeroActions(versions.length > 0, hasActive);
  renderChipSlot(d);
  renderHist(d);
  await renderAuto();
  await renderSeasons();
}

function markWelcome(hasAgent, hasDraft, hasActive) {
  const set = (id, cls) => {
    const el = $(id);
    if (el) el.className = `step ${cls}`;
  };
  set("w-agent", hasAgent ? "done" : "next");
  set("w-chip", !hasAgent ? "" : hasActive || hasDraft ? "done" : "next");
  set("w-arena", hasAgent && hasActive ? "done" : "");
  const next = $("hero-next");
  const link = $("hero-next-link");
  if (next && link) {
    if (!hasAgent) {
      show(next, false);
    } else if (!hasDraft) {
      link.textContent = "Program first chip";
      show(next, true);
    } else {
      link.textContent = "Go to Chip Lab";
      show(next, true);
    }
  }
}

// One leader owns one hero. The breed form only exists before the first breed.
function paintBreedState(hasAgent) {
  show($("breed-row"), !hasAgent);
  show($("breed-hint"), !hasAgent);
  if (hasAgent && !justBred) show($("breed-msg"), false);
  justBred = false;
}

function paintHeroActions(hasDraft, hasActive) {
  const p = $("hero-primary");
  const s = $("hero-secondary");
  if (!hasDraft) {
    p.textContent = "Program first chip";
    p.href = "./chip.html";
    s.textContent = "Enter arena";
    s.href = "./index.html#arena-card";
  } else if (!hasActive) {
    p.textContent = "Install a chip";
    p.href = "./chip.html";
    s.textContent = "Enter arena";
    s.href = "./index.html#arena-card";
  } else {
    p.textContent = "Enter arena";
    p.href = "./index.html#arena-card";
    s.textContent = "Open Chip Lab";
    s.href = "./chip.html";
  }
}

function renderChipSlot(d) {
  const slot = $("chip-slot");
  const versions = d.versions || [];
  const active = versions.find((v) => v.versionId === d.agent.activeVersionId);
  slot.textContent = active ? `▦ CHIP: ${versionTitle(active)}` : "▦ CHIP: EMPTY";
  slot.classList.toggle("filled", Boolean(active));
}

function openChipPicker() {
  const d = latestDash;
  if (!d) return;
  const versions = (d.versions || []).slice().reverse();
  if (!versions.length) {
    window.showModal({
      eyebrow: "Agent chip",
      title: "NO CHIPS YET",
      body: "Compile your first battle plan in the Chip Lab.",
      actions: [
        { label: "Open Chip Lab", primary: true, onClick: () => { location.href = "./chip.html"; } },
        { label: "Close" },
      ],
    });
    return;
  }
  window.showModal({
    eyebrow: "Agent chip",
    title: "INSTALL CHIP",
    body: "One chip drives the arena. Pick the mind.",
    listRows: versions.map((v) => ({
      title: versionTitle(v) + (v.versionId === d.agent.activeVersionId ? " · ACTIVE" : ""),
      sub: v.corrupt ? "Unreadable draft." : `${v.fights} fights · ${v.wins} wins · ${(v.winRate * 100).toFixed(0)}%`,
      buttonLabel: v.versionId === d.agent.activeVersionId || v.corrupt ? null : "Install",
      onClick: async () => {
        const r = await call("POST", `/v1/agents/${d.agent.id}/policies/install`, { versionId: v.versionId });
        toastSay(r.status === 200 ? "Chip installed." : `Install failed: ${r.data.error || r.status}.`);
        await refresh();
      },
    })),
    actions: [{ label: "Close" }],
  });
}

async function renderSeasons() {
  const r = await call("GET", "/v1/seasons");
  const box = $("seasons");
  box.textContent = "";
  const rows = (r.status === 200 && r.data.seasons) || [];
  if (!rows.length) {
    box.innerHTML = "<p class='sub'>Season one still runs. Archives land here at rollover.</p>";
  }
  for (const s of rows) {
    const p = document.createElement("p");
    p.className = "sub";
    const top = (s.rows || []).slice(0, 3).map((x) => `#${x.rank} ${x.ap} AP`).join(", ");
    p.textContent = `${s.seasonId} closed ${new Date(s.closedAt).toLocaleDateString()} — ${top}`;
    box.appendChild(p);
  }
  show($("season-card"), true);
}

async function renderAuto() {
  const r = await call("GET", "/v1/autobattle/digest");
  if (r.status !== 200) {
    $("auto-status").textContent = "AutoBattle unavailable.";
    show($("auto-card"), true);
    return;
  }
  const d = r.data;
  const lease = d.leaseExpiresAt ? `lease ends ${new Date(d.leaseExpiresAt).toLocaleString()}` : "no lease";
  $("auto-status").textContent = d.optIn
    ? `Running — ${d.state}, energy ${d.energy.energy}/${d.energy.energyMax}, ${lease}, ${d.stopReason}.`
    : `Off — ${d.stopReason}. Press start for a 24h lease.`;
  const box = $("auto-recent");
  box.textContent = "";
  for (const h of d.recent || []) {
    const p = document.createElement("p");
    p.className = "sub";
    p.textContent = `${h.winner} wins in ${h.ticks} ticks — AP ${h.myDelta >= 0 ? "+" : ""}${h.myDelta} · ${h.myPaid} AC `;
    const a = document.createElement("a");
    a.href = `./index.html?replay=${h.matchId}`;
    a.className = "link-quiet";
    a.textContent = "replay";
    p.appendChild(a);
    box.appendChild(p);
  }
  show($("auto-card"), true);
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
    a.className = "link-quiet";
    a.textContent = "replay";
    p.appendChild(a);
    const why = document.createElement("button");
    why.className = "btn-ghost";
    why.type = "button";
    why.textContent = "Why";
    why.addEventListener("click", async () => {
      why.disabled = true;
      const r = await call("POST", `/v1/battles/${h.matchId}/analysis`);
      why.disabled = false;
      const old = p.querySelector(".why-text");
      if (old) old.remove();
      const span = document.createElement("span");
      span.className = "sub why-text";
      span.textContent = r.status === 200 ? ` — ${r.data.explanation.text}` : " — no explanation yet.";
      p.appendChild(span);
    });
    p.appendChild(why);
    box.appendChild(p);
  }
  show($("hist-card"), true);
}

const GATED = { "#hist-card": "Fight history" };

// Sidebar anchors land on locked sections while signed out. Say so once,
// then point at the login card instead of a blank scroll.
function gatedHashNote() {
  const hit = GATED[location.hash];
  if (!hit || token) return;
  if (typeof window.toast === "function") window.toast(`Sign in to unlock the ${hit}.`);
  const login = $("login-card");
  if (login) login.scrollIntoView();
}

async function boot() {
  const handle = localStorage.getItem(HANDLE_KEY) || "";
  if (handle) $("handle").value = handle;
  if (!token) {
    gatedHashNote();
    return;
  }
  $("pill-who").textContent = localStorage.getItem(HANDLE_KEY) || "signed in";
  const me = await call("GET", "/v1/me");
  if (me.status !== 200) {
    token = "";
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  show($("login-card"), false);
  show($("hero-card"), true);
  if (me.data.agent) {
    agentId = me.data.agent.id;
    paintBreedState(true);
    await refresh();
  } else {
    paintBreedState(false);
    show($("breed-msg"), true);
    $("hero-primary").textContent = "Breed your hero";
    $("hero-primary").href = "#breed-row";
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

$("chip-slot").addEventListener("click", () => {
  if (typeof window.showModal === "function") openChipPicker();
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
  justBred = true;
  paintBreedState(true);
  $("breed-msg").textContent = r.data.portraitUrl
    ? "Hero bred with a portrait."
    : `Hero bred ${r.data.portraitStatus} — art can retry later, fights start now.`;
  toastSay("Hero bred. Program its first chip.");
  await refresh();
});

$("auto-opt").addEventListener("click", async () => {
  $("auto-status").textContent = "Starting the 24h lease…";
  const r = await call("POST", "/v1/autobattle/opt-in");
  if (r.status !== 200) {
    $("auto-status").textContent = `Start failed: ${r.data.error || r.status}.`;
    return;
  }
  await refresh();
});

$("auto-pause").addEventListener("click", async () => {
  await call("POST", "/v1/autobattle/pause");
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
  if (r.data.portraitStatus === "failed") {
    $("hero-art-status").textContent = `Portrait paint failed: ${r.data.error || "unknown image error"}.`;
    return;
  }
  await refresh();
});

$("share-btn").addEventListener("click", async () => {
  const handle = localStorage.getItem(HANDLE_KEY) || "";
  if (!handle) return;
  const link = `${location.origin}/public.html?handle=${encodeURIComponent(handle)}`;
  try {
    await navigator.clipboard.writeText(link);
    show($("share-msg"), true);
    toastSay("Link copied.");
  } catch {
    $("share-msg").textContent = `Copy failed — the link is ${link}`;
    show($("share-msg"), true);
  }
});

boot();
