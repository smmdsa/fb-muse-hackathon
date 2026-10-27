// Quick match. Same-origin API, token shared with the profile page.

const qmStatus = document.getElementById("qm-status");
const qmResult = document.getElementById("qm-result");
const qmEnergy = document.getElementById("qm-energy");
const qmFind = document.getElementById("qm-find");
const qmCasual = document.getElementById("qm-casual");
const qmRanked = document.getElementById("qm-ranked");

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

async function qmBoot() {
  if (!qmToken) {
    qmEnergy.textContent = "energy —";
    return;
  }
  const me = await qmCall("GET", "/v1/me");
  if (me.status !== 200) return;
  qmVersion = (me.data.agent && me.data.agent.active_version_id) || "";
  qmEnergy.textContent = `energy ${me.data.energy.energy}/${me.data.energy.energyMax}`;
}

async function qmPoll(ticketId, left) {
  if (left <= 0) {
    qmSay("Still waiting. The ticket stays open — check back soon.");
    qmFind.disabled = false;
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
    qmSay("Fight settled.");
    qmFind.disabled = false;
    qmBoot();
    return;
  }
  if (r.data.status === "expired") {
    qmSay("No humans queued in ten minutes. Ticket expired — energy stays spent.");
    qmFind.disabled = false;
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
    qmSay("Matched at once.");
    qmFind.disabled = false;
    qmBoot();
    return;
  }
  qmPoll(r.data.id, qmMode === "casual" ? 8 : 40);
});

qmPick("casual");
qmBoot();
