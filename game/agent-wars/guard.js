// Login wall. Runs before render on every private page. A 401
// sends the visitor to the wallet login. A first-time login
// without a handle sends them to the handle page instead.

(async () => {
  const page = (location.pathname.split("/").pop() || "index.html") + location.search;
  const headers = {};
  try {
    const token = localStorage.getItem("aw_token");
    if (token) headers.authorization = `Bearer ${token}`;
  } catch {
    // Storage is closed. The cookie session still works.
  }
  let me = null;
  try {
    const res = await fetch("/v1/me", { headers });
    if (res.status === 401) {
      location.replace(`./auth.html?next=${encodeURIComponent(page)}`);
      return;
    }
    if (res.ok) me = await res.json().catch(() => null);
  } catch {
    return; // The API is down. The page shows its own errors.
  }
  if (me && me.handleSet === false) location.replace("./handle.html");
})();
