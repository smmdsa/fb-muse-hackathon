// Arena page. Lobby queues normal or ranked; matches auto-accept into
// the battle view. Same-origin API, token shared with the barracks page.

const arenaStatus = document.getElementById("qm-status");
const arenaResult = document.getElementById("qm-result");
const arenaCancel = document.getElementById("qm-cancel");
const queueNormal = document.getElementById("queue-normal");
const queueRanked = document.getElementById("queue-ranked");
const lobbyView = document.getElementById("lobby-view");
const battleView = document.getElementById("battle-view");

let arenaMode = "casual";
let arenaVersion = "";
let arenaTicket = "";
let arenaTimer = 0;
let arenaClock = 0;
let arenaClockTimer = 0;
let autoMode = "";
let autoCooldownTick = 0;
let autoEndObserver = null;
let autoQueueTimer = 0;
let autoQueueSec = 0;

const ARENA_REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const FADE_MS = ARENA_REDUCED ? 0 : 450;

function arenaSay(text) {
  arenaStatus.textContent = text;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function toastSay(msg) {
  if (typeof window.toast === "function") window.toast(msg);
}

async function arenaCall(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...window.AWSession.authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// One view fades out, the other fades in. Reduced motion skips the wait.
function showView(next) {
  const prev = next === battleView ? lobbyView : battleView;
  const reveal = () => {
    prev.hidden = true;
    prev.classList.remove("fade-out");
    next.hidden = false;
    next.classList.add("fade-out");
    requestAnimationFrame(() => requestAnimationFrame(() => next.classList.remove("fade-out")));
    next.scrollIntoView({ block: "start", behavior: ARENA_REDUCED ? "auto" : "smooth" });
  };
  if (prev.hidden) {
    reveal();
    return;
  }
  prev.classList.add("fade-out");
  window.setTimeout(reveal, FADE_MS);
}

function showLobby() {
  showView(lobbyView);
}

function showBattle() {
  showView(battleView);
}

function markMode(mode) {
  document.getElementById("mode-normal").classList.toggle("active", mode === "casual");
  document.getElementById("mode-ranked").classList.toggle("active", mode === "ranked");
}

async function arenaBoot() {
  const sess = await window.AWSession.refreshIdentity();
  markMode(arenaMode);
  if (!sess.ok) {
    setText("qm-pick", "Sign in with your wallet. Then queue.");
    return;
  }
  const me = { status: 200, data: sess.me };
  arenaVersion = (me.data.agent && me.data.agent.active_version_id) || "";
  const hasAgent = Boolean(me.data.agent);
  const hasChip = Boolean(arenaVersion);
  if (!hasAgent) {
    setText("qm-pick", "Breed an agent in the barracks first.");
    return;
  }
  const img = document.getElementById("score-a-img");
  if (img && me.data.agent.portrait_url) {
    img.src = me.data.agent.portrait_url;
    img.hidden = false;
  }
  setText("score-a-name", (me.data.agent.name || "YOU").toUpperCase().slice(0, 12));
  setText("qm-pick", hasChip
    ? `Agent ${me.data.agent.name || "ready"} with chip v${String(arenaVersion).slice(0, 8)} enters ${arenaMode}.`
    : "Install a chip in the barracks first.");
}

function clockStart() {
  clockStop();
  arenaClock = 0;
  const el = document.getElementById("qm-clock");
  if (el) el.hidden = false;
  arenaClockTimer = setInterval(() => {
    arenaClock += 1;
    if (el) el.textContent = `${arenaClock}s`;
  }, 1000);
}

function clockStop() {
  clearInterval(arenaClockTimer);
  const el = document.getElementById("qm-clock");
  if (el) el.hidden = true;
}

function queueBusy(busy) {
  queueNormal.disabled = busy;
  queueRanked.disabled = busy;
  if (arenaCancel) arenaCancel.hidden = !busy || !arenaTicket;
}

function econFor(match, myVersion) {
  const mine = match.a_version === myVersion ? "a" : "b";
  const d = mine === "a" ? match.delta_a : match.delta_b;
  const paid = mine === "a" ? match.paid_a : match.paid_b;
  if (match.rated) return `AP ${d >= 0 ? "+" : ""}${d} · ${paid} AC`;
  return `${paid} AC · unrated`;
}

// One play per settle. The replay must match the stored checksum.
function localSideOf(match, myVersion) {
  if (match.b_version === myVersion) return "B";
  return "A";
}

function agentDisplayName(card, fallback) {
  const n = card && card.name ? String(card.name) : fallback;
  return n.toUpperCase().slice(0, 12);
}

function perspectiveMeta(match, data, myVersion) {
  const agents = (data && data.agents) || {};
  const portraits = {};
  const names = {};
  for (const k of ["a", "b"]) {
    const card = agents[k] || null;
    names[k] = agentDisplayName(card, k === "a" ? "CYAN" : "CRIMSON");
    portraits[k] = card && card.portrait_url ? card.portrait_url : null;
  }
  return {
    perspective: localSideOf(match, myVersion),
    names,
    portraits,
  };
}

// Series result line. The replay owns the score: rounds never
// touch the matches table, so the text renders after load.
function arenaSeriesText(match, replay) {
  const s = replay.score || { A: 0, B: 0 };
  const rounds = (replay.rounds || []).map((r) => "R" + r.round + " " + r.winner).join(" - ");
  arenaResult.hidden = false;
  arenaResult.textContent = `${match.winner} takes the series ${s.A}-${s.B} (${rounds}). ${match.rated ? "Rated." : "Unrated sparring."}`;
  toastSay(`${match.winner} takes the series ${s.A}-${s.B}.`);
}

async function playSettled(match) {
  if (!match || !match.id) return;
  const r = await arenaCall("GET", `/v1/matches/${match.id}/replay`);
  if (r.status !== 200 || !r.data.replay || (!r.data.replay.frames && !r.data.replay.rounds)) {
    arenaSay("Replay unavailable — the result stands.");
    if (autoMode) startCooldown();
    return;
  }
  if (r.data.replay.checksum !== match.checksum) {
    arenaSay("Replay checksum differs — the result stands.");
    if (autoMode) startCooldown();
    return;
  }
  if (r.data.replay.version === 3 && r.data.replay.rounds) {
    arenaSeriesText(match, r.data.replay);
  }
  if (typeof window.playServerReplay === "function") {
    window.playServerReplay(r.data.replay, {
      winner: match.winner,
      ticks: match.ticks,
      checksumOk: true,
      econ: econFor(match, arenaVersion),
      startedAt: r.data.startedAt || 0,
      serverNow: r.data.now || 0,
      ...perspectiveMeta(match, r.data, arenaVersion),
    });
  }
}

function onSettled(m, instant) {
  const foe = String(m.b_version).startsWith("bot:") ? `sparring ${m.b_version}` : "a ranked foe";
  arenaResult.hidden = false;
  arenaResult.textContent = m.mode === "arena"
    ? `Series settled: ${m.winner} takes it - loading rounds...`
    : instant
    ? `${m.winner} wins in ${m.ticks} ticks. ${m.rated ? "Rated." : "Unrated sparring."}`
    : `${m.winner} wins in ${m.ticks} ticks vs ${foe}. ${m.rated ? "Rated." : "Unrated."} Details on the dashboard.`;
  arenaSay(instant ? "Matched at once — entering the arena." : "Match found — entering the arena.");
  toastSay(m.mode === "arena" ? `${m.winner} takes the series.` : `${m.winner} wins in ${m.ticks} ticks.`);
  arenaTicket = "";
  queueBusy(false);
  clockStop();
  hideAutoQueue();
  showBattle();
  paintAutoBanner();
  playSettled(m);
  arenaBoot();
}

async function pollTicket(ticketId, left, fails = 0) {
  if (left <= 0) {
    if (autoMode) {
      arenaSay("AUTO BATTLE ON — still waiting for a foe.");
      arenaTimer = setTimeout(() => pollTicket(ticketId, 40, 0), 5000);
      return;
    }
    arenaSay("Still waiting. The ticket stays open — check back soon.");
    arenaTicket = "";
    queueBusy(false);
    clockStop();
    return;
  }
  const r = await arenaCall("GET", `/v1/matchmaking/${ticketId}`);
  if (r.status !== 200) {
    // The settle runs the whole battle inside one request. A busy server
    // answers 503 while it works, so the poll retries instead of dying.
    if (fails < 8) {
      arenaSay("Server is settling the battle — retrying…");
      arenaTimer = setTimeout(() => pollTicket(ticketId, left, fails + 1), 5000);
      return;
    }
    arenaSay("Ticket lost. Queue again.");
    arenaTicket = "";
    queueBusy(false);
    clockStop();
    return;
  }
  if (r.data.status === "settled" && r.data.match) {
    onSettled(r.data.match, false);
    return;
  }
  if (r.data.status === "expired") {
    if (autoMode) {
      arenaSay("Ticket expired — auto battle requeues.");
      await requeueAuto();
      return;
    }
    arenaSay("No humans queued in ten minutes. Ticket expired — the slot is freed.");
    arenaTicket = "";
    queueBusy(false);
    clockStop();
    arenaBoot();
    return;
  }
  if (r.data.status === "canceled") {
    haltAuto();
    showLobby();
    arenaSay("Ticket canceled. The slot is freed. Queue again when ready.");
    arenaTicket = "";
    queueBusy(false);
    clockStop();
    arenaBoot();
    return;
  }
  if (arenaMode === "casual" && r.data.settle_at) {
    const secs = Math.max(0, Math.ceil((r.data.settle_at - Date.now()) / 1000));
    arenaSay(`${autoMode ? "AUTO BATTLE ON — " : ""}Waiting for a same-ELO foe… sparring bot in ${secs}s. Cancel frees the slot.`);
  } else {
    arenaSay(`${autoMode ? "AUTO BATTLE ON — " : ""}Waiting for a same-ELO human… Cancel frees the slot.`);
  }
  arenaTimer = setTimeout(() => pollTicket(ticketId, left - 1, 0), 5000);
}

async function queue(mode, viaAuto = false) {
  if (!viaAuto) haltAuto();
  clearTimeout(arenaTimer);
  arenaResult.hidden = true;
  arenaMode = mode;
  markMode(mode);
  const sess = await window.AWSession.loadMe();
  if (!sess.ok) {
    arenaSay("Sign in with your wallet first.");
    return;
  }
  await arenaBoot();
  if (!arenaVersion) {
    arenaSay("Breed an agent and install a chip in the barracks first.");
    return;
  }
  queueBusy(true);
  arenaSay(viaAuto ? `AUTO BATTLE ON — queueing ${mode === "ranked" ? "RANKED" : "NORMAL"}.` : "Queueing…");
  if (viaAuto) paintAutoBanner();
  clockStart();
  const r = await arenaCall("POST", "/v1/matchmaking/request", { versionId: arenaVersion, mode: arenaMode });
  if (r.status !== 201 && r.status !== 200) {
    if (viaAuto) {
      haltAuto(`Auto battle stopped: ${r.data.error || r.status}.`);
    } else {
      arenaSay(`Queue refused: ${r.data.error || r.status}.`);
    }
    queueBusy(false);
    clockStop();
    return;
  }
  if (r.status === 200) arenaSay("Ticket still open — resuming the wait.");
  if (r.data.status === "settled" && r.data.match) {
    onSettled(r.data.match, r.status === 201);
    return;
  }
  arenaTicket = r.data.id || "";
  queueBusy(true);
  pollTicket(r.data.id, arenaMode === "casual" ? 8 : 40);
}

queueNormal.addEventListener("click", () => queue("casual"));
queueRanked.addEventListener("click", () => queue("ranked"));

if (arenaCancel) {
  arenaCancel.addEventListener("click", async () => {
    if (!arenaTicket) return;
    clearTimeout(arenaTimer);
    haltAuto();
    showLobby();
    const r = await arenaCall("POST", `/v1/matchmaking/${arenaTicket}/cancel`);
    arenaTicket = "";
    queueBusy(false);
    clockStop();
    if (r.status === 200) {
      arenaSay("Ticket canceled. The slot is freed. Queue again when ready.");
      arenaBoot();
    } else {
      arenaSay(`Cancel failed: ${r.data.error || r.status}.`);
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

// The endcard button returns to the lobby. game.js still owns the sim;
// this page owns the flow, so the sandbox-restart listener stays behind
// on the detached node.
const endBtn = document.getElementById("again-btn");
if (endBtn) {
  const fresh = endBtn.cloneNode(true);
  endBtn.replaceWith(fresh);
  fresh.addEventListener("click", () => {
    haltAuto();
    hideArenaOverlay();
    showLobby();
    arenaBoot();
  });
}

for (const id of ["start-btn", "restart-btn"]) {
  const b = document.getElementById(id);
  if (b) b.addEventListener("click", () => {
    hideArenaOverlay();
    showBattle();
  });
}

// Auto battle loop. The barracks deeplinks here with ?auto=<mode>.
// Tickets settle, the replay plays, the endcard fires a 10s cooldown,
// then the loop requeues while the 24h lease stays live.
// The loop never shows the lobby: the battle view carries a queue
// panel with a wait clock until the match settles.
function fmtWait(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}min ${s}sec`;
}

function showAutoQueue(mode) {
  const box = document.getElementById("auto-queue");
  if (!box) return;
  setText("auto-queue-mode", mode === "ranked" ? "RANKED MODE" : "NORMAL MODE");
  setText("auto-queue-text", `Waiting for opponent ${fmtWait(0)}`);
  box.hidden = false;
  hideArenaOverlay();
  clearInterval(autoQueueTimer);
  autoQueueSec = 0;
  autoQueueTimer = setInterval(() => {
    autoQueueSec += 1;
    setText("auto-queue-text", `Waiting for opponent ${fmtWait(autoQueueSec)}`);
  }, 1000);
}

function hideAutoQueue() {
  clearInterval(autoQueueTimer);
  const box = document.getElementById("auto-queue");
  if (box) box.hidden = true;
}
function autoBannerText(mode) {
  return `${mode === "ranked" ? "RANKED" : "NORMAL"} MODE · AUTO BATTLE ON`;
}

function paintAutoBanner(extra) {
  const b = document.getElementById("auto-banner");
  if (!b) return;
  if (!autoMode) {
    b.hidden = true;
    return;
  }
  b.hidden = false;
  b.textContent = extra || autoBannerText(autoMode);
}

function haltAuto(msg) {
  autoMode = "";
  clearInterval(autoCooldownTick);
  clearTimeout(arenaTimer);
  hideAutoQueue();
  paintAutoBanner();
  if (msg) arenaSay(msg);
}

async function requeueAuto() {
  if (!autoMode) return;
  const d = await arenaCall("GET", "/v1/autobattle/digest");
  const live = d.status === 200 && d.data.optIn && d.data.state !== "PAUSED_MANUAL"
    && (!d.data.leaseExpiresAt || Date.now() < d.data.leaseExpiresAt);
  if (!live) {
    haltAuto("Auto battle stopped — lease paused or expired.");
    showLobby();
    await arenaBoot();
    return;
  }
  showBattle();
  showAutoQueue(autoMode);
  await queue(autoMode, true);
}

function startCooldown() {
  if (!autoMode) return;
  let left = 10;
  const tick = () => {
    if (!autoMode) return;
    paintAutoBanner(`${autoBannerText(autoMode)} · NEXT QUEUE IN ${left}`);
    arenaSay(`Result stands. Next queue in ${left}s.`);
  };
  tick();
  clearInterval(autoCooldownTick);
  autoCooldownTick = setInterval(() => {
    left -= 1;
    if (!autoMode) {
      clearInterval(autoCooldownTick);
      return;
    }
    if (left <= 0) {
      clearInterval(autoCooldownTick);
      requeueAuto();
      return;
    }
    tick();
  }, 1000);
}

function watchEndcard() {
  const ec = document.getElementById("endcard");
  if (!ec || autoEndObserver) return;
  let wasHidden = ec.hidden;
  autoEndObserver = new MutationObserver(() => {
    const shown = !ec.hidden;
    if (autoMode && shown && wasHidden) startCooldown();
    wasHidden = !shown;
  });
  autoEndObserver.observe(ec, { attributes: true, attributeFilter: ["hidden"] });
}

markMode("casual");
arenaBoot();

// Deep link from the barracks: ?auto=casual|ranked starts the loop.
(async function bootAutoParam() {
  const params = new URLSearchParams(location.search);
  const mode = params.get("auto");
  if (mode !== "casual" && mode !== "ranked") return;
  if (params.get("replay")) return;
  const sess = await window.AWSession.loadMe();
  if (!sess.ok) return;
  await arenaBoot();
  if (!arenaVersion) return;
  autoMode = mode;
  markMode(mode);
  watchEndcard();
  showBattle();
  paintAutoBanner();
  showAutoQueue(mode);
  await queue(mode, true);
})();

// Deep link from history rows: ?replay=<matchId> plays it straight away.
(async function bootReplayParam() {
  const id = new URLSearchParams(location.search).get("replay");
  if (!id) return;
  const sess = await window.AWSession.loadMe();
  if (!sess.ok) return;
  await arenaBoot();
  const r = await arenaCall("GET", `/v1/matches/${id}/replay`);
  if (r.status !== 200 || !r.data.replay || (!r.data.replay.frames && !r.data.replay.rounds)) return;
  const stored = r.data.stored || {};
  const ok = r.data.identical === true && r.data.replay.checksum === stored.checksum;
  const mine = stored.a_version === arenaVersion ? "a" : stored.b_version === arenaVersion ? "b" : null;
  const econ = mine
    ? econFor(stored, arenaVersion)
    : `${stored.rated ? "rated" : "unrated"} · ${stored.ticks} ticks`;
  showBattle();
  if (r.data.replay.version === 3 && r.data.replay.rounds) {
    arenaSeriesText(stored, r.data.replay);
  }
  if (typeof window.playServerReplay === "function") {
    window.playServerReplay(r.data.replay, {
      winner: stored.winner,
      ticks: stored.ticks,
      checksumOk: ok,
      econ,
      ...perspectiveMeta(stored, r.data, arenaVersion),
    });
  }
})();