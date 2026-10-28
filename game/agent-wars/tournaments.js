// Championship page. Same-origin API, token lives in localStorage only.

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "aw_token";
const HANDLE_KEY = "aw_handle";
const CUP_ID = "s1-kickoff";

let token = localStorage.getItem(TOKEN_KEY) || "";

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

function short(id) {
  return String(id || "?").slice(0, 14);
}

function show(el, on) {
  el.hidden = !on;
}

async function refresh() {
  if (!token) {
    $("cup-status").textContent = "Sign in in the barracks, then register.";
    show($("cup-empty"), true);
    return;
  }
  const r = await call("GET", `/v1/tournaments/${CUP_ID}`);
  if (r.status !== 200) {
    $("cup-status").textContent = "Cup unavailable. Run the API and retry.";
    return;
  }
  const cup = r.data;
  const seats = `${cup.entries.length}/${cup.maxPlayers} seats`;
  if (cup.phase === "REGISTRATION_OPEN") {
    $("cup-status").textContent = `Open — ${seats}. Registration locks the installed version.`;
  } else if (cup.phase === "COMPLETED") {
    $("cup-status").textContent = `Complete — ${seats}. Champion ${short(cup.bracket.championId)}.`;
  } else {
    $("cup-status").textContent = `${cup.phase} — ${seats}.`;
  }
  show($("cup-empty"), cup.entries.length === 0);
  renderBracket(cup);
  renderGames(cup);
}

function renderBracket(cup) {
  const box = $("bracket");
  box.textContent = "";
  if (!cup.bracket) {
    show($("bracket-card"), false);
    return;
  }
  for (let round = 1; round <= cup.bracket.rounds; round += 1) {
    const head = document.createElement("p");
    head.className = "ver-head";
    head.textContent = round === cup.bracket.rounds && cup.bracket.rounds > 1 ? `Final (best of ${cup.bracket.slots.find((s) => s.round === round).bestOf})` : `Round ${round}`;
    box.appendChild(head);
    for (const s of cup.bracket.slots.filter((x) => x.round === round)) {
      const p = document.createElement("p");
      p.className = "sub";
      const win = s.winnerId ? `winner ${short(s.winnerId)}` : "unplayed";
      p.textContent = `${s.id}: ${short(s.slotA)} ${s.winsA} — ${s.winsB} ${short(s.slotB)} · ${win}`;
      box.appendChild(p);
    }
  }
  show($("bracket-card"), true);
}

function renderGames(cup) {
  const box = $("cup-games");
  box.textContent = "";
  const games = cup.games || {};
  const ids = Object.keys(games);
  if (!ids.length) {
    show($("cup-games-card"), false);
    return;
  }
  for (const slotId of ids) {
    for (const matchId of games[slotId]) {
      const p = document.createElement("p");
      p.className = "sub";
      p.textContent = `${slotId} · ${short(matchId)} `;
      const a = document.createElement("a");
      a.href = `./index.html?replay=${matchId}`;
      a.className = "link-quiet";
      a.textContent = "replay";
      p.appendChild(a);
      box.appendChild(p);
    }
  }
  show($("cup-games-card"), true);
}

$("cup-register").addEventListener("click", async () => {
  if (!token) {
    $("cup-status").textContent = "Sign in in the barracks first.";
    return;
  }
  const me = await call("GET", "/v1/me");
  const version = me.data && me.data.agent && me.data.agent.active_version_id;
  if (!version) {
    $("cup-status").textContent = "Install a version in the barracks first.";
    return;
  }
  $("cup-status").textContent = "Registering…";
  const r = await call("POST", `/v1/tournaments/${CUP_ID}/register`, { versionId: version });
  if (r.status !== 201) {
    $("cup-status").textContent = `Registration failed: ${r.data.error || r.status}.`;
    return;
  }
  $("cup-status").textContent = r.data.started
    ? "Eighth seat filled — the bracket played to a champion."
    : "Registered — frozen at lock.";
  await refresh();
  if (typeof window.showModal === "function") {
    window.showModal({
      eyebrow: "S1 Kickoff Cup",
      title: r.data.started ? "BRACKET COMPLETE" : "REGISTERED",
      body: r.data.started
        ? "Eighth seat filled — the bracket played to a champion."
        : `Version ${short(version)} locked in. Win to advance.`,
      actions: [
        { label: "View bracket", primary: true, onClick: () => $("bracket-card").scrollIntoView() },
        { label: "Close" },
      ],
    });
  }
});

$("pill-who").textContent = token ? (localStorage.getItem(HANDLE_KEY) || "signed in") : "signed out";

refresh();
