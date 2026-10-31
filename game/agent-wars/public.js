// Public fighter card. No auth to view. Auth to report.
const $ = (id) => document.getElementById(id);
function show(el, on) {
  el.hidden = !on;
}

function silhouetteFor(id, skin) {
  const hues = { "skin-ember": 18, "skin-tide": 190 };
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  const hue = hues[skin] ?? (h % 360);
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'>"
    + "<rect width='96' height='96' fill='#101923'/>"
    + `<rect x='30' y='32' width='36' height='30' fill='#5b6577'/>`
    + `<rect x='42' y='38' width='12' height='8' fill='hsl(${hue},90%,60%)'/>`
    + "</svg>";
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function renderStandings(mine) {
  const empty = $("standings-empty");
  const table = $("standings-table");
  const body = $("standings-body");
  let res;
  try {
    res = await fetch("/v1/leaderboard");
  } catch {
    res = null;
  }
  if (!res || res.status !== 200) {
    empty.textContent = "Standings unavailable — run the API and retry.";
    return;
  }
  const data = await res.json().catch(() => ({}));
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (data.seasonId) $("standings-sub").textContent = `Season ${data.seasonId} · best first.`;
  if (!rows.length) {
    empty.textContent = "No placed leaders yet — be the first to climb.";
    return;
  }
  body.textContent = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    if (mine && r.handle === mine) tr.className = "me";
    const pos = document.createElement("td");
    pos.textContent = String(r.rank ?? "—");
    const op = document.createElement("td");
    if (r.handle) {
      const a = document.createElement("a");
      a.href = `./public.html?handle=${encodeURIComponent(r.handle)}`;
      a.textContent = r.handle;
      op.appendChild(a);
    } else {
      op.textContent = "—";
    }
    const ag = document.createElement("td");
    ag.textContent = r.agentName || "—";
    const tier = document.createElement("td");
    tier.textContent = `${r.tier || "—"}${r.division ? " " + r.division : ""}`;
    const ap = document.createElement("td");
    ap.textContent = String(r.ap ?? "—");
    tr.append(pos, op, ag, tier, ap);
    body.appendChild(tr);
  }
  show(empty, false);
  show(table, true);
}

async function main() {
  const sess = await window.AWSession.refreshIdentity();
  const handle = new URLSearchParams(location.search).get("handle") || "";
  if (!handle) {
    await renderStandings(window.AWSession.handleOf(sess));
    return;
  }
  show($("standings-card"), false);
  const res = await fetch(`/v1/leaders/${encodeURIComponent(handle)}/public`);
  if (res.status !== 200) {
    show($("missing"), true);
    return;
  }
  const card = await res.json();
  $("card-name").textContent = (card.agent && card.agent.name) || card.handle;
  $("card-rank").textContent = `${card.ap} AP — ${card.tier}${card.division ? " " + card.division : ""}`;
  const rec = card.agent ? `${card.agent.wins}W – ${card.agent.losses}L across ranked and open fights` : "no hero bred yet";
  $("card-record").textContent = rec;
  $("card-skin").textContent = card.agent && card.agent.equippedSkin
    ? `marches in ${card.agent.equippedSkin}`
    : "marches in stock steel";
  const img = $("card-img");
  img.src = (card.agent && card.agent.portraitUrl) || silhouetteFor(card.handle, card.agent && card.agent.equippedSkin);
  show(img, true);
  show($("card"), true);
  show($("report-card"), true);
  show($("report-login"), !sess.ok);
  show($("report-btn"), sess.ok);
  $("copy-btn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      show($("copy-msg"), true);
      if (typeof window.toast === "function") window.toast("Link copied.");
    } catch {
      $("copy-msg").textContent = "Copy failed — grab the address bar URL instead.";
      show($("copy-msg"), true);
    }
  });
  if (sess.ok) {
    $("report-btn").addEventListener("click", async () => {
      const reason = $("reason").value.trim();
      const r = await fetch(`/v1/leaders/${encodeURIComponent(handle)}/report`, {
        method: "POST",
        headers: { "content-type": "application/json", ...window.AWSession.authHeaders() },
        body: JSON.stringify({ reason }),
      });
      const msg = $("report-msg");
      msg.textContent = r.status === 200 ? "Report received. Thanks." : "Report failed — say why in a few words.";
      show(msg, true);
      if (typeof window.toast === "function" && r.status === 200) window.toast("Report received. Thanks.");
    });
  }
}

main();
