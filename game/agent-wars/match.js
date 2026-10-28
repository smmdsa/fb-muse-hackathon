// Quick match. Same-origin API, token shared with the profile page.

const qmStatus = document.getElementById("qm-status");
const qmResult = document.getElementById("qm-result");
const qmEnergy = document.getElementById("qm-energy");
const qmFind = document.getElementById("qm-find");
const qmCancel = document.getElementById("qm-cancel");
const qmCasual = document.getElementById("qm-casual");
const qmRanked = document.getElementById("qm-ranked");
let qmTicket = "";

let qmMode = "casual";
let qmToken = localStorage.getItem("aw_token") || "";
let qmVersion = "";
let qmTimer = 0;
let qmClock = 0;
let qmClockTimer = 0;

function qmSay(text) {
  qmStatus.textContent = text;
}

function qmPick(mode) {
  qmMode = mode;
  qmCasual.className = mode === "casual" ? "btn-primary" : "btn-ghost";
  qmRanked.className = mode === "ranked" ? "btn-primary" : "btn-ghost";
}

async function qmCall(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${qmToken}` },
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
    cta.href = "#quick-card";
  }
}

function lobbySay(name, rank, energy) {
  setText("lobby-name", name);
  setText("lobby-rank", rank);
  setText("lobby-energy", energy);
}

async function qmBoot() {
  const who = document.getElementById("pill-who");
  if (who) who.textContent = qmToken ? (localStorage.getItem("aw_handle") || "signed in") : "signed out";
  if (!qmToken) {
    qmEnergy.textContent = "energy —";
    lobbySay("No agent yet", "Breed an agent to enter the league.", "energy —");
    setText("lobby-chip", "No chip yet");
    setText("lobby-chip-detail", "Sign in in the barracks. Then compile a chip.");
    setText("lobby-ap", "— AP");
    setText("rank-line", "Sign in to see your climb.");
    markSteps(false, false);
    primaryCta(false, false);
    return;
  }
  const me = await qmCall("GET", "/v1/me");
  if (me.status !== 200) return;
  qmVersion = (me.data.agent && me.data.agent.active_version_id) || "";
  const hasAgent = Boolean(me.data.agent);
  const hasChip = Boolean(qmVersion);
  qmEnergy.textContent = `energy ${me.data.energy.energy}/${me.data.energy.energyMax}`;
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
  const scoreImg = document.getElementById("score-a-img");
  if (scoreImg && me.data.agent.portrait_url) {
    scoreImg.src = me.data.agent.portrait_url;
    scoreImg.hidden = false;
  }
  lobbySay(
    me.data.agent.name || "Unnamed hero",
    `${me.data.leader.ap} AP — ${me.data.leader.tier || "PROTOTYPE"}.`,
    `energy ${me.data.energy.energy}/${me.data.energy.energyMax} — one per fight.`,
  );
  setText("score-a-name", (me.data.agent.name || "YOU").toUpperCase().slice(0, 12));
  setText("lobby-chip", hasChip ? `Chip v${String(qmVersion).slice(0, 8)}` : "No chip yet");
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
  setText("qm-pick", hasChip ? `Agent ${me.data.agent.name || "ready"} with chip v${String(qmVersion).slice(0, 8)} enters ${qmMode}.` : "Install a chip in the barracks first.");
  markSteps(true, hasChip);
  primaryCta(true, hasChip);
  const autoEl = document.getElementById("lobby-auto");
  if (autoEl) autoEl.textContent = autoLine;
}

function qmClockStart() {
  qmClockStop();
  qmClock = 0;
  const el = document.getElementById("qm-clock");
  if (el) el.hidden = false;
  qmClockTimer = setInterval(() => {
    qmClock += 1;
    if (el) el.textContent = `${qmClock}s`;
  }, 1000);
}

function qmClockStop() {
  clearInterval(qmClockTimer);
  const el = document.getElementById("qm-clock");
  if (el) el.hidden = true;
}

async function qmPoll(ticketId, left) {
  if (left <= 0) {
    qmSay("Still waiting. The ticket stays open — check back soon.");
    qmFind.disabled = false;
    if (qmCancel) qmCancel.hidden = true;
    qmTicket = "";
    qmClockStop();
    return;
  }
  const r = await qmCall("GET", `/v1/matchmaking/${ticketId}`);
  if (r.status !== 200) {
    qmSay("Ticket lost. Queue again.");
    qmFind.disabled = false;
    qmClockStop();
    return;
  }
  if (r.data.status === "settled" && r.data.match) {
    const m = r.data.match;
    const foe = String(m.b_version).startsWith("bot:") ? `sparring ${m.b_version}` : "a ranked foe";
    qmResult.hidden = false;
    qmResult.textContent = `${m.winner} wins in ${m.ticks} ticks vs ${foe}. ${m.rated ? "Rated." : "Unrated."} Details on the dashboard.`;
    qmSay("Fight settled — loading the server replay.");
    setText("lower-last", `${m.winner} · ${m.ticks} TICKS`);
    toastSay(`${m.winner} wins in ${m.ticks} ticks.`);
    qmFind.disabled = false;
    if (qmCancel) qmCancel.hidden = true;
    qmTicket = "";
    qmClockStop();
    qmBoot();
    playSettled(m);
    return;
  }
  if (r.data.status === "expired") {
    qmSay("No humans queued in ten minutes. Ticket expired — the charge is refunded.");
    qmFind.disabled = false;
    if (qmCancel) qmCancel.hidden = true;
    qmTicket = "";
    qmClockStop();
    qmBoot();
    return;
  }
  if (qmMode === "casual" && r.data.settle_at) {
    const secs = Math.max(0, Math.ceil((r.data.settle_at - Date.now()) / 1000));
    qmSay(`Waiting for a same-ELO foe… sparring bot in ${secs}s. Cancel keeps your energy.`);
  } else {
    qmSay("Waiting for a same-ELO human… Cancel keeps your energy.");
  }
  qmTimer = setTimeout(() => qmPoll(ticketId, left - 1), 5000);
}

qmCasual.addEventListener("click", () => { qmPick("casual"); qmBoot(); });
qmRanked.addEventListener("click", () => { qmPick("ranked"); qmBoot(); });

qmFind.addEventListener("click", async () => {
  clearTimeout(qmTimer);
  qmResult.hidden = true;
  if (!qmToken) {
    qmSay("Sign in in the barracks first.");
    return;
  }
  await qmBoot();
  if (!qmVersion) {
    qmSay("Breed an agent and install a chip in the barracks first.");
    return;
  }
  qmFind.disabled = true;
  qmSay("Queueing… one energy.");
  qmClockStart();
  const r = await qmCall("POST", "/v1/matchmaking/request", { versionId: qmVersion, mode: qmMode });
  if (r.status !== 201) {
    qmSay(`Queue refused: ${r.data.error || r.status}.`);
    qmFind.disabled = false;
    qmClockStop();
    return;
  }
  if (r.data.status === "settled" && r.data.match) {
    const m = r.data.match;
    qmResult.hidden = false;
    qmResult.textContent = `${m.winner} wins in ${m.ticks} ticks. ${m.rated ? "Rated." : "Unrated sparring."}`;
    setText("lower-last", `${m.winner} · ${m.ticks} TICKS`);
    toastSay(`${m.winner} wins in ${m.ticks} ticks.`);
    qmSay("Matched at once — loading the server replay.");
    qmFind.disabled = false;
    qmClockStop();
    qmBoot();
    playSettled(m);
    return;
  }
  qmTicket = r.data.id || "";
  if (qmCancel && qmTicket) qmCancel.hidden = false;
  qmPoll(r.data.id, qmMode === "casual" ? 8 : 40);
});

function econFor(match, myVersion) {
  const mine = match.a_version === myVersion ? "a" : "b";
  const d = mine === "a" ? match.delta_a : match.delta_b;
  const paid = mine === "a" ? match.paid_a : match.paid_b;
  if (match.rated) return `AP ${d >= 0 ? "+" : ""}${d} · ${paid} AC`;
  return `${paid} AC · unrated`;
}

// One play per settle. The replay must match the stored checksum.
async function playSettled(match) {
  if (!match || !match.id) return;
  const r = await qmCall("GET", `/v1/matches/${match.id}/replay`);
  if (r.status !== 200 || !r.data.replay || !r.data.replay.frames) {
    qmSay("Replay unavailable — the result stands.");
    return;
  }
  if (r.data.replay.checksum !== match.checksum) {
    qmSay("Replay checksum differs — the result stands.");
    return;
  }
  if (typeof window.playServerReplay === "function") {
    window.playServerReplay(r.data.replay, {
      winner: match.winner,
      ticks: match.ticks,
      checksumOk: true,
      econ: econFor(match, qmVersion),
    });
  }
}

if (qmCancel) {
  qmCancel.addEventListener("click", async () => {
    if (!qmTicket) return;
    clearTimeout(qmTimer);
    const r = await qmCall("POST", `/v1/matchmaking/${qmTicket}/cancel`);
    qmTicket = "";
    qmCancel.hidden = true;
    qmFind.disabled = false;
    qmClockStop();
    if (r.status === 200) {
      qmSay("Ticket canceled — the charge is refunded. Queue again when ready.");
      qmBoot();
    } else {
      qmSay(`Cancel failed: ${r.data.error || r.status}.`);
    }
  });
}

function hideArenaOverlay() {
  const o = document.getElementById("arena-overlay");
  if (o) o.hidden = true;
}

// Every server replay path runs through this bridge. Same signature,
// same contract — the overlay just steps aside first.
if (typeof window.playServerReplay === "function") {
  const bridge = window.playServerReplay;
  window.playServerReplay = (replay, meta) => {
    hideArenaOverlay();
    bridge(replay, meta);
  };
}

for (const id of ["start-btn", "again-btn"]) {
  const b = document.getElementById(id);
  if (b) b.addEventListener("click", hideArenaOverlay);
}

function toastSay(msg) {
  if (typeof window.toast === "function") window.toast(msg);
}

qmPick("casual");
qmBoot();

// Deep link from the profile history: ?replay=<matchId> plays it.
(async function bootReplayParam() {
  const id = new URLSearchParams(location.search).get("replay");
  if (!id || !qmToken) return;
  await qmBoot();
  const r = await qmCall("GET", `/v1/matches/${id}/replay`);
  if (r.status !== 200 || !r.data.replay || !r.data.replay.frames) return;
  const stored = r.data.stored || {};
  const ok = r.data.identical === true && r.data.replay.checksum === stored.checksum;
  const active = qmVersion;
  const mine = stored.a_version === active ? "a" : stored.b_version === active ? "b" : null;
  const econ = mine
    ? econFor(stored, active)
    : `${stored.rated ? "rated" : "unrated"} · ${stored.ticks} ticks`;
  if (typeof window.playServerReplay === "function") {
    window.playServerReplay(r.data.replay, {
      winner: stored.winner,
      ticks: stored.ticks,
      checksumOk: ok,
      econ,
    });
  }
})();
