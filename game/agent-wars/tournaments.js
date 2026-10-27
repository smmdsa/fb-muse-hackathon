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
    $("cup-status").textContent = "Sign in on the profile page, then register.";
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
      a.textContent = "replay";
      p.appendChild(a);
      box.appendChild(p);
    }
  }
  show($("cup-games-card"), true);
}

$("cup-register").addEventListener("click", async () => {
  if (!token) {
    $("cup-status").textContent = "Sign in on the profile page first.";
    return;
  }
  const me = await call("GET", "/v1/me");
  const version = me.data && me.data.agent && me.data.agent.active_version_id;
  if (!version) {
    $("cup-status").textContent = "Install a version on the profile page first.";
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
});

$("pill-who").textContent = token ? (localStorage.getItem(HANDLE_KEY) || "signed in") : "signed out";

// Organizer console. The key stays in session memory: a closed tab forgets it.
const NEXT = {
  DRAFT: "ANNOUNCED",
  ANNOUNCED: "REGISTRATION_OPEN",
  REGISTRATION_OPEN: "LOCKED",
  LOCKED: "LIVE",
  SEEDED: "LIVE",
  LIVE: "COMPLETED",
  COMPLETED: null,
  CANCELLED: null,
};

function adminKey() {
  return ($("admin-key") && $("admin-key").value) || sessionStorage.getItem("aw_admin") || "";
}

async function adminCall(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-key": adminKey() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function renderEvents() {
  const box = $("events");
  box.textContent = "";
  const r = await call("GET", "/v1/tournaments");
  if (r.status !== 200) {
    $("admin-msg").textContent = "Sign in on the profile page to list events.";
    return;
  }
  for (const t of r.data.tournaments || []) {
    const p = document.createElement("p");
    p.className = "sub";
    p.textContent = `${t.name} (${t.id}) — ${t.phase}, ${t.entries}/${t.maxPlayers} seats `;
    const next = NEXT[t.phase];
    if (next && adminKey()) {
      const btn = document.createElement("button");
      btn.className = "btn-ghost";
      btn.type = "button";
      btn.textContent = `Advance to ${next}`;
      btn.addEventListener("click", async () => {
        const out = await adminCall(`/v1/admin/events/${t.id}/transition`, { to: next });
        $("admin-msg").textContent = out.status === 200
          ? `${t.id} is now ${next}.`
          : `Advance failed: ${out.data.error || out.status}.`;
        await renderEvents();
        await refresh();
      });
      p.appendChild(btn);
    }
    box.appendChild(p);
  }
}

$("admin-key").value = sessionStorage.getItem("aw_admin") || "";
$("admin-key").addEventListener("change", () => {
  sessionStorage.setItem("aw_admin", $("admin-key").value);
  renderEvents();
});

$("ev-create").addEventListener("click", async () => {
  if (!adminKey()) {
    $("admin-msg").textContent = "Paste the admin key first.";
    return;
  }
  const size = Math.min(64, Math.max(2, parseInt($("ev-size").value, 10) || 8));
  const out = await adminCall("/v1/admin/events", {
    id: $("ev-id").value.trim(),
    name: $("ev-name").value.trim(),
    maxPlayers: size,
    minAp: 0,
    registrationCloseAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });
  $("admin-msg").textContent = out.status === 201
    ? `Draft ${out.data.id} created. Advance it to open registration.`
    : `Create failed: ${out.data.error || out.status}.`;
  await renderEvents();
});

refresh();
renderEvents();
