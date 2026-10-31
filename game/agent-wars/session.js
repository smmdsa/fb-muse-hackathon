// Shared session. Cookie rides first, Bearer [REDACTED] stays for old clients.
// Every game page loads this file before its own script.
(function () {
  "use strict";

  var TOKEN_KEY = "aw_token";
  var cached = null;

  function bearerToken() {
    try {
      return window.localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  // Pure: headers for a token. Empty token means cookie-only.
  function authHeadersFor(token) {
    if (token) return { authorization: "Bearer " + token };
    return {};
  }

  function authHeaders() {
    return authHeadersFor(bearerToken());
  }

  async function call(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: Object.assign({ "content-type": "application/json" }, authHeaders()),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  // One cached identity per page load. True forces a refresh.
  async function loadMe(force) {
    if (cached && !force) return cached;
    try {
      const r = await call("GET", "/v1/me");
      cached = r.status === 200 ? { ok: true, me: r.data } : { ok: false, me: null };
    } catch {
      cached = { ok: false, me: null };
    }
    return cached;
  }

  function handleOf(sess) {
    if (!sess || !sess.ok || !sess.me || !sess.me.leader) return "";
    return sess.me.leader.handle || "";
  }

  // Pure: pill model from a session. In shows the handle, out links in.
  function pillModel(sess, page) {
    const handle = handleOf(sess);
    if (sess && sess.ok) return { state: "in", text: handle || "signed in", href: null };
    return { state: "out", text: "Sign in", href: "./auth.html?next=" + encodeURIComponent(page || "index.html") };
  }

  function paintPill(sess) {
    const pill = document.getElementById("pill-who");
    if (!pill) return;
    const page = (window.location.pathname.split("/").pop() || "index.html") + window.location.search;
    const model = pillModel(sess, page);
    pill.dataset.state = model.state;
    pill.textContent = "";
    if (!model.href) {
      pill.textContent = model.text;
      pill.title = "Signed in";
      return;
    }
    const a = document.createElement("a");
    a.href = model.href;
    a.textContent = model.text;
    pill.appendChild(a);
    pill.title = "Signed out";
  }

  // Resolve identity and paint the pill. Pages gate on sess.ok.
  async function refreshIdentity() {
    const sess = await loadMe(true);
    paintPill(sess);
    return sess;
  }

  function forget() {
    cached = null;
  }

  const api = { authHeaders, authHeadersFor, call, loadMe, handleOf, pillModel, paintPill, refreshIdentity, forget, TOKEN_KEY };
  if (typeof window !== "undefined") window.AWSession = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
