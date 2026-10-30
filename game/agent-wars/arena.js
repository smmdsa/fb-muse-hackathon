// Arena page. Lobby queues normal or ranked; matches auto-accept into
// the battle view. Same-origin API, token shared with the barracks page.

const arenaStatus = document.getElementById("qm-status");
const arenaResult = document.getElementById("qm-result");
const arenaEnergy = document.getElementById("qm-energy");
const arenaCancel = document.getElementById("qm-cancel");
const queueNormal = document.getElementById("queue-normal");
const queueRanked = document.getElementById("queue-ranked");
const lobbyView = document.getElementById("lobby-view");
const battleView = document.getElementById("battle-view");

let arenaMode = "casual";
let arenaToken = localStorage.getItem("aw_token") || "";
let arenaVersion = "";
let arenaTicket = "";
let arenaTimer = 0;
let arenaClock = 0;
let arenaClockTimer = 0;

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
    headers: { "content-type": "application/json", authorization: `Bearer ${arenaToken}` },
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
  const who = document.getElementById("pill-who");
  if (who) who.textContent = arenaToken ? (localStorage.getItem("aw_handle") || "signed in") : "signed out";
  markMode(arenaMode);
  if (!arenaToken) {
    arenaEnergy.textContent = "energy —";
    setText("qm-pick", "Sign in from the barracks. Then queue.");
    return;
  }
  const me = await arenaCall("GET", "/v1/me");
  if (me.status !== 200) return;
  arenaVersion = (me.data.agent && me.data.agent.active_version_id) || "";
  const hasAgent = Boolean(me.data.agent);
  const hasChip = Boolean(arenaVersion);
  arenaEnergy.textContent = `energy ${me.data.energy.energy}/${me.data.energy.energyMax}`;
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
    return;
  }
  if (r.data.replay.checksum !== match.checksum) {
    arenaSay("Replay checksum differs — the result stands.");
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
  showBattle();
  playSettled(m);
  arenaBoot();
}

async function pollTicket(ticketId, left, fails = 0) {
  if (left <= 0) {
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
    arenaSay("No humans queued in ten minutes. Ticket expired — the charge is refunded.");
    arenaTicket = "";
    queueBusy(false);
    clockStop();
    arenaBoot();
    return;
  }
  if (r.data.status === "canceled") {
    arenaSay("Ticket canceled — the charge is refunded. Queue again when ready.");
    arenaTicket = "";
    queueBusy(false);
    clockStop();
    arenaBoot();
    return;
  }
  if (arenaMode === "casual" && r.data.settle_at) {
    const secs = Math.max(0, Math.ceil((r.data.settle_at - Date.now()) / 1000));
    arenaSay(`Waiting for a same-ELO foe… sparring bot in ${secs}s. Cancel keeps your energy.`);
  } else {
    arenaSay("Waiting for a same-ELO human… Cancel keeps your energy.");
  }
  arenaTimer = setTimeout(() => pollTicket(ticketId, left - 1, 0), 5000);
}

async function queue(mode) {
  clearTimeout(arenaTimer);
  arenaResult.hidden = true;
  arenaMode = mode;
  markMode(mode);
  if (!arenaToken) {
    arenaSay("Sign in in the barracks first.");
    return;
  }
  await arenaBoot();
  if (!arenaVersion) {
    arenaSay("Breed an agent and install a chip in the barracks first.");
    return;
  }
  queueBusy(true);
  arenaSay("Queueing… one energy.");
  clockStart();
  const r = await arenaCall("POST", "/v1/matchmaking/request", { versionId: arenaVersion, mode: arenaMode });
  if (r.status !== 201 && r.status !== 200) {
    arenaSay(`Queue refused: ${r.data.error || r.status}.`);
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
    const r = await arenaCall("POST", `/v1/matchmaking/${arenaTicket}/cancel`);
    arenaTicket = "";
    queueBusy(false);
    clockStop();
    if (r.status === 200) {
      arenaSay("Ticket canceled — the charge is refunded. Queue again when ready.");
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

markMode("casual");
arenaBoot();

// Deep link from history rows: ?replay=<matchId> plays it straight away.
(async function bootReplayParam() {
  const id = new URLSearchParams(location.search).get("replay");
  if (!id || !arenaToken) return;
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
