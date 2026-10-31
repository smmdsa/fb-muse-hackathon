// Wallet sign-in page. Same-origin API. The session lives in an
// httpOnly cookie, so this page never sees the token itself.

const $ = (id) => document.getElementById(id);

let account = "";

async function call(method, path, body) {
  return window.AWSession.call(method, path, body);
}

function toastSay(msg) {
  if (typeof window.toast === "function") window.toast(msg);
}

function short(addr) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function show(el, on) {
  el.hidden = !on;
}

function safeNext(raw) {
  if (typeof raw === "string" && /^[a-z0-9_-]+\.html(\?.*)?$/i.test(raw)) return `./${raw}`;
  return "./arena.html";
}

async function refresh() {
  const r = await call("GET", "/v1/me");
  if (r.status !== 200) {
    $("pill-who").textContent = "signed out";
    $("auth-status").textContent = account ? `Connected as ${short(account)}. Sign to enter.` : "No wallet connected.";
    show($("connect-btn"), !account);
    show($("sign-btn"), !!account);
    show($("logout-btn"), false);
    $("auth-address").hidden = true;
    return;
  }
  const addr = r.data.leader.wallet_address || "";
  const handle = r.data.handleSet === true ? (r.data.leader.handle || "") : "";
  $("pill-who").textContent = handle || (addr ? short(addr) : "signed in");
  $("auth-status").textContent = "Signed in. The arena awaits.";
  if (addr) {
    $("auth-address").textContent = short(addr);
    $("auth-address").hidden = false;
  }
  show($("connect-btn"), false);
  show($("sign-btn"), false);
  show($("logout-btn"), true);
}

$("connect-btn").addEventListener("click", async () => {
  const eth = window.ethereum;
  if (!eth || typeof eth.request !== "function") {
    $("auth-status").textContent = "No Ethereum wallet found in this browser.";
    show($("nowallet-link"), true);
    return;
  }
  try {
    const accounts = await eth.request({ method: "eth_requestAccounts" });
    account = (accounts && accounts[0]) || "";
  } catch {
    account = "";
  }
  if (!account) {
    $("auth-status").textContent = "Connection rejected. Try again when ready.";
    return;
  }
  await refresh();
});

$("sign-btn").addEventListener("click", async () => {
  if (!account) return;
  $("auth-status").textContent = "Waiting for the wallet signature…";
  $("sign-btn").disabled = true;
  const c = await call("POST", "/v1/auth/challenge", { address: account });
  if (c.status !== 200) {
    $("auth-status").textContent = `Challenge failed: ${c.data.error || c.status}.`;
    $("sign-btn").disabled = false;
    return;
  }
  let signature = "";
  try {
    signature = await window.ethereum.request({ method: "personal_sign", params: [c.data.message, account] });
  } catch {
    signature = "";
  }
  if (!signature) {
    $("auth-status").textContent = "Signature rejected. Nothing was signed.";
    $("sign-btn").disabled = false;
    return;
  }
  const r = await call("POST", "/v1/auth/wallet", { address: account, message: c.data.message, signature, nonce: c.data.nonce });
  if (r.status !== 200) {
    $("auth-status").textContent = `Sign-in failed: ${r.data.error || r.status}.`;
    $("sign-btn").disabled = false;
    return;
  }
  toastSay("Signed in.");
  const params = new URLSearchParams(location.search);
  const me = await call("GET", "/v1/me");
  if (me.status === 200 && me.data && me.data.handleSet === false) {
    window.location.href = "./handle.html";
    return;
  }
  window.location.href = safeNext(params.get("next")); // First logins pick a handle first.
});

$("logout-btn").addEventListener("click", async () => {
  await call("POST", "/v1/auth/logout");
  account = "";
  await refresh();
});

refresh();
