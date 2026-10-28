// Armory page. Same-origin API. Token lives in localStorage only.

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "aw_token";
const HANDLE_KEY = "aw_handle";

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

function show(el, on) {
  el.hidden = !on;
}

const SLOT_ART = { skin: "◆", trail: "✧", banner: "⚑" };

async function renderArmory() {
  const r = await call("GET", "/v1/armory");
  if (r.status !== 200) {
    $("armory-wallet").textContent = "Armory unavailable.";
    show($("armory-card"), true);
    return;
  }
  $("armory-wallet").textContent = `${r.data.ac} AC · ${r.data.rp} mock RP in the wallet.`;
  const box = $("armory");
  box.textContent = "";
  const equipped = r.data.equipped || {};
  for (const c of r.data.catalog || []) {
    const slot = c.id.split("-")[0];
    const card = document.createElement("div");
    card.className = "product";
    const art = document.createElement("div");
    art.className = "art";
    art.textContent = SLOT_ART[slot] || "◆";
    const label = document.createElement("span");
    label.className = "micro";
    label.textContent = slot;
    const name = document.createElement("h3");
    name.textContent = c.name;
    const price = document.createElement("p");
    price.className = "sub";
    const state = Object.values(equipped).includes(c.id) ? " · equipped" : c.owned ? " · owned" : "";
    price.textContent = `${c.price} ${c.currency}${state}`;
    card.append(art, label, name, price);
    const btn = document.createElement("button");
    btn.type = "button";
    if (!c.owned) {
      btn.className = "btn-primary";
      btn.textContent = "Buy";
      btn.addEventListener("click", async () => {
        const out = await call("POST", "/v1/armory/buy", { itemId: c.id });
        if (out.status !== 200) {
          $("armory-wallet").textContent = `Buy failed: ${out.data.error || out.status}.`;
          return;
        }
        await renderArmory();
      });
    } else {
      btn.className = "btn-ghost";
      btn.textContent = "Equip";
      btn.addEventListener("click", async () => {
        await call("POST", "/v1/armory/equip", { slot, itemId: c.id });
        await renderArmory();
      });
    }
    card.appendChild(btn);
    box.appendChild(card);
  }
  show($("armory-card"), true);
}

async function boot() {
  const handle = localStorage.getItem(HANDLE_KEY) || "";
  if (handle) $("handle").value = handle;
  if (!token) return;
  $("pill-who").textContent = localStorage.getItem(HANDLE_KEY) || "signed in";
  const me = await call("GET", "/v1/me");
  if (me.status !== 200) {
    token = "";
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  show($("login-card"), false);
  await renderArmory();
}

$("login-btn").addEventListener("click", async () => {
  const handle = $("handle").value.trim();
  if (!handle) {
    $("login-msg").textContent = "Type a handle first.";
    return;
  }
  $("login-msg").textContent = "Signing in…";
  const r = await call("POST", "/v1/auth/session", { handle });
  if (r.status !== 200) {
    $("login-msg").textContent = "Sign in failed. Run the API and retry.";
    return;
  }
  token = r.data.token;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(HANDLE_KEY, handle);
  await boot();
});

boot();
