// Organizer console. Key stays in tab memory: a closed tab forgets it.

const $ = (id) => document.getElementById(id);
function headers() {
  return { "content-type": "application/json", ...window.AWSession.authHeaders() };
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
    $("admin-msg").textContent = "Sign in with your wallet to list events.";
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

window.AWSession.refreshIdentity();
renderEvents();
