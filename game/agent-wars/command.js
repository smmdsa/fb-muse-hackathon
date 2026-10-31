// Command deck. Same-origin API, token shared with the barracks page.
// Queue and battle live in the arena page; this file only paints COMMAND.

async function cmdCall(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...window.AWSession.authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function tierProgress(ap, tier) {
  const bands = { PROTOTYPE: [0, 299], CIRCUIT: [300, 599], CORE: [600, 899], ASCENDANT: [900, 1199], SINGULARITY: [1200, 2000] };
  const b = bands[String(tier || "PROTOTYPE").toUpperCase()] || bands.PROTOTYPE;
  const pct = Math.min(100, Math.max(0, ((ap - b[0]) / Math.max(1, b[1] - b[0])) * 100));
  return { pct, label: `${b[0]}–${b[1]} AP` };
}

function markSteps(hasAgent, hasChip) {
  const a = document.getElementById("step-agent");
  const c = document.getElementById("step-chip");
  const r = document.getElementById("step-arena");
  if (!a || !c || !r) return;
  a.className = "step" + (hasAgent ? " done" : " next");
  c.className = "step" + (!hasAgent ? "" : hasChip ? " done" : " next");
  r.className = "step" + (hasAgent && hasChip ? " next" : "");
}

function primaryCta(hasAgent, hasChip) {
  const cta = document.getElementById("cta-primary");
  if (!cta) return;
  if (!hasAgent) {
    cta.textContent = "Create my agent";
    cta.href = "./profile.html";
  } else if (!hasChip) {
    cta.textContent = "Program my chip";
    cta.href = "./chip.html";
  } else {
    cta.textContent = "Play";
    cta.href = "./arena.html";
  }
}

function lobbySay(name, rank, energy) {
  setText("lobby-name", name);
  setText("lobby-rank", rank);
  setText("lobby-energy", energy);
}

async function cmdBoot() {
  const sess = await window.AWSession.refreshIdentity();
  if (!sess.ok) {
    lobbySay("No agent yet", "Breed an agent to enter the league.", "energy —");
    setText("lobby-chip", "No chip yet");
    setText("lobby-chip-detail", "Sign in with your wallet. Then compile a chip.");
    setText("lobby-ap", "— AP");
    setText("rank-line", "Sign in to see your climb.");
    markSteps(false, false);
    primaryCta(false, false);
    return;
  }
  const me = { status: 200, data: sess.me };
  const hasAgent = Boolean(me.data.agent);
  const hasChip = Boolean(me.data.agent && me.data.agent.active_version_id);
  setText("lower-energy", `${me.data.energy.energy}/${me.data.energy.energyMax}`);
  const lowerBar = document.getElementById("lower-energybar");
  if (lowerBar) lowerBar.style.width = `${(me.data.energy.energy / Math.max(1, me.data.energy.energyMax)) * 100}%`;
  const autoLine = me.data.auto && me.data.auto.optIn
    ? `AutoBattle on — ${me.data.auto.state}.`
    : "AutoBattle off — start it in the barracks.";
  if (!hasAgent) {
    lobbySay("No agent yet", "Breed one in the barracks, then queue.", `energy ${me.data.energy.energy}/${me.data.energy.energyMax}`);
    const autoEl = document.getElementById("lobby-auto");
    if (autoEl) autoEl.textContent = autoLine;
    markSteps(false, false);
    primaryCta(false, false);
    return;
  }
  const img = document.getElementById("lobby-img");
  if (img && me.data.agent.portrait_url) {
    img.src = me.data.agent.portrait_url;
    img.hidden = false;
    img.classList.remove("empty");
  }
  lobbySay(
    me.data.agent.name || "Unnamed hero",
    `${me.data.leader.ap} AP — ${me.data.leader.tier || "PROTOTYPE"}.`,
    `energy ${me.data.energy.energy}/${me.data.energy.energyMax} — one per fight.`,
  );
  setText("lobby-chip", hasChip ? `Chip v${String(me.data.agent.active_version_id).slice(0, 8)}` : "No chip yet");
  setText("lobby-chip-detail", hasChip ? "Active version fights. Change it in the barracks." : "Compile and install a chip in the barracks.");
  setText("lobby-ap", `${me.data.leader.ap} AP`);
  setText("lobby-tier", `${me.data.leader.tier || "PROTOTYPE"}${me.data.leader.division ? " " + me.data.leader.division : ""}`);
  setText("rank-line", `${me.data.leader.ap} AP — ${me.data.leader.tier || "PROTOTYPE"}`);
  const prog = tierProgress(me.data.leader.ap, me.data.leader.tier);
  const bar = document.getElementById("lobby-progress");
  if (bar) bar.style.width = `${prog.pct}%`;
  setText("lobby-next", `${prog.label}. Win fights to climb.`);
  setText("rank-range", prog.label);
  const shield = document.getElementById("lobby-shield");
  if (shield) shield.src = `./assets/shields/${String(me.data.leader.tier || "prototype").toLowerCase()}.png`;
  const rankShield = document.getElementById("rank-shield");
  if (rankShield) rankShield.src = `./assets/shields/${String(me.data.leader.tier || "prototype").toLowerCase()}.png`;
  markSteps(true, hasChip);
  primaryCta(true, hasChip);
  const autoEl = document.getElementById("lobby-auto");
  if (autoEl) autoEl.textContent = autoLine;
  const dash = await cmdCall("GET", `/v1/agents/${me.data.agent.id}/dashboard`);
  const last = dash.status === 200 && dash.data.history && dash.data.history[0];
  setText("lower-last", last ? `${last.mode === "arena" ? last.winner + " SERIES" : last.winner} · ${last.ticks} TICKS` : "NO FIGHTS YET");
}

cmdBoot();
