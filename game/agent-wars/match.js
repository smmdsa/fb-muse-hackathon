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

function lobbySay(name, rank, energy) {
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set("lobby-name", name);
  set("lobby-rank", rank);
  set("lobby-energy", energy);
}

async function qmBoot() {
  const who = document.getElementById("pill-who");
  if (who) who.textContent = qmToken ? (localStorage.getItem("aw_handle") || "signed in") : "signed out";
  if (!qmToken) {
    qmEnergy.textContent = "energy —";
    lobbySay("No hero yet", "Sign in and breed on the profile page.", "energy —");
    return;
  }
  const me = await qmCall("GET", "/v1/me");
  if (me.status !== 200) return;
  qmVersion = (me.data.agent && me.data.agent.active_version_id) || "";
  qmEnergy.textContent = `energy ${me.data.energy.energy}/${me.data.energy.energyMax}`;
  const autoLine = me.data.auto && me.data.auto.optIn
    ? `AutoBattle on — ${me.data.auto.state}, ${me.data.auto.ran} fought on this visit.`
    : "AutoBattle off — start it on the profile page.";
  if (!me.data.agent) {
    lobbySay("No hero yet", "Breed one on the profile page, then queue.", `energy ${me.data.energy.energy}/${me.data.energy.energyMax}`);
    const autoEl = document.getElementById("lobby-auto");
    if (autoEl) autoEl.textContent = autoLine;
    return;
  }
  const img = document.getElementById("lobby-img");
  if (img && me.data.agent.portrait_url) {
    img.src = me.data.agent.portrait_url;
    img.hidden = false;
  }
  lobbySay(
    me.data.agent.name || "Unnamed hero",
    `${me.data.leader.ap} AP — breed, train, and climb.`,
    `energy ${me.data.energy.energy}/${me.data.energy.energyMax} — one per fight.`,
  );
  const autoEl = document.getElementById("lobby-auto");
  if (autoEl) autoEl.textContent = autoLine;
}

async function qmPoll(ticketId, left) {
  if (left <= 0) {
    qmSay("Still waiting. The ticket stays open — check back soon.");
    qmFind.disabled = false;
    if (qmCancel) qmCancel.hidden = true;
    qmTicket = "";
    return;
  }
  const r = await qmCall("GET", `/v1/matchmaking/${ticketId}`);
  if (r.status !== 200) {
    qmSay("Ticket lost. Queue again.");
    qmFind.disabled = false;
    return;
  }
  if (r.data.status === "settled" && r.data.match) {
    const m = r.data.match;
    const foe = String(m.b_version).startsWith("bot:") ? `sparring ${m.b_version}` : "a ranked foe";
    qmResult.hidden = false;
    qmResult.textContent = `${m.winner} wins in ${m.ticks} ticks vs ${foe}. ${m.rated ? "Rated." : "Unrated."} Details on the profile dashboard.`;
    qmSay("Fight settled — loading the server replay.");
    qmFind.disabled = false;
    if (qmCancel) qmCancel.hidden = true;
    qmTicket = "";
    qmBoot();
    playSettled(m);
    return;
  }
  if (r.data.status === "expired") {
    qmSay("No humans queued in ten minutes. Ticket expired — the charge is refunded.");
    qmFind.disabled = false;
    if (qmCancel) qmCancel.hidden = true;
    qmTicket = "";
    qmBoot();
    return;
  }
  if (qmMode === "casual" && r.data.settle_at) {
    const secs = Math.max(0, Math.ceil((r.data.settle_at - Date.now()) / 1000));
    qmSay(`Waiting for a same-ELO foe… sparring bot in ${secs}s.`);
  } else {
    qmSay("Waiting for a same-ELO human…");
  }
  qmTimer = setTimeout(() => qmPoll(ticketId, left - 1), 5000);
}

qmCasual.addEventListener("click", () => qmPick("casual"));
qmRanked.addEventListener("click", () => qmPick("ranked"));

qmFind.addEventListener("click", async () => {
  clearTimeout(qmTimer);
  qmResult.hidden = true;
  if (!qmToken) {
    qmSay("Sign in on the profile page first.");
    return;
  }
  await qmBoot();
  if (!qmVersion) {
    qmSay("Breed a hero and compile a version on the profile page first.");
    return;
  }
  qmFind.disabled = true;
  qmSay("Queueing… one energy.");
  const r = await qmCall("POST", "/v1/matchmaking/request", { versionId: qmVersion, mode: qmMode });
  if (r.status !== 201) {
    qmSay(`Queue refused: ${r.data.error || r.status}.`);
    qmFind.disabled = false;
    return;
  }
  if (r.data.status === "settled" && r.data.match) {
    const m = r.data.match;
    qmResult.hidden = false;
    qmResult.textContent = `${m.winner} wins in ${m.ticks} ticks. ${m.rated ? "Rated." : "Unrated sparring."}`;
    qmSay("Matched at once — loading the server replay.");
    qmFind.disabled = false;
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
    if (r.status === 200) {
      qmSay("Ticket canceled — the charge is refunded. Queue again when ready.");
      qmBoot();
    } else {
      qmSay(`Cancel failed: ${r.data.error || r.status}.`);
    }
  });
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
