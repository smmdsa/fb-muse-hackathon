// Shared AI factory cooldown. The server remains authoritative across tabs and devices.
// Unknown status never locks the controls: checking, offline, and signed-out
// stay open, and the server enforces on submit. Only a known cooldown or an
// in-flight build disables the factory controls.
(() => {
  const selector = '[data-factory-control], .factory-analysis';
  const SYNC_TIMEOUT_MS = 8000;
  let until = 0;
  let mode = 'checking'; // checking | ready | cooling | busy | offline | signed-out
  const locked = new WeakMap();
  const message = document.createElement('p');
  message.className = 'sub factory-cooldown';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  const mount = document.querySelector('#train-card') || document.querySelector('#breed-card') || document.querySelector('main');
  if (mount) mount.prepend(message);

  function secondsLeft() {
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  }

  function blocked() {
    if (mode === 'busy') return true;
    if (mode === 'cooling') return secondsLeft() > 0;
    return false;
  }

  function render() {
    if (mode === 'cooling' && secondsLeft() <= 0) mode = 'ready';
    const off = blocked();
    for (const el of document.querySelectorAll(selector)) {
      if (off) {
        if (!locked.has(el)) locked.set(el, el.disabled);
        el.disabled = true;
      } else if (locked.has(el)) {
        el.disabled = locked.get(el) || (el.id === 'compile-btn' && !window.factoryAgentReady);
        locked.delete(el);
      }
    }
    const s = secondsLeft();
    if (mode === 'busy') message.textContent = 'AI FACTORY · Building your request…';
    else if (mode === 'offline') message.textContent = 'AI FACTORY · Status unreachable — the server decides on submit. Retrying…';
    else if (mode === 'signed-out') message.textContent = 'AI FACTORY · Sign in to build.';
    else if (mode === 'checking') message.textContent = 'AI FACTORY · Checking the assembly bay…';
    else if (mode === 'cooling') message.textContent = `AI FACTORY · Assembly bay cooling down. Next build in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.`;
    else message.textContent = 'AI FACTORY · Assembly bay ready.';
  }

  async function sync() {
    // Cookie sessions ride without a header. Bearer [REDACTED] stays for old clients.
    const headers = window.AWSession ? window.AWSession.authHeaders() : {};
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), SYNC_TIMEOUT_MS) : 0;
    try {
      const res = await fetch('/v1/ai/cooldown', {
        headers,
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (res.status === 401) { mode = 'signed-out'; render(); return; }
      if (!res.ok) throw new Error('cooldown status ' + res.status);
      const data = await res.json();
      // Server timestamps beat the client clock. Old servers without `now`
      // fall back to the relative retry window.
      const serverNow = Number(data.now);
      const next = Number(data.nextAllowedAt);
      if (Number.isFinite(serverNow) && Number.isFinite(next) && next > 0) {
        until = Date.now() + Math.max(0, next - serverNow);
      } else {
        until = Date.now() + Math.max(0, Number(data.retryAfterSeconds) || 0) * 1000;
      }
      mode = 'cooling';
    } catch {
      mode = 'offline';
    } finally {
      if (timer) clearTimeout(timer);
    }
    render();
  }

  function aiPath(method, path) {
    return method === 'POST' && (path === '/v1/agents' || /\/policies\/compile$|\/portrait\/retry$|\/analysis$/.test(path));
  }

  window.factoryCooldown = {
    start(method, path) { if (aiPath(method, path)) { mode = 'busy'; render(); } },
    async finish(method, path) { if (aiPath(method, path)) await sync(); },
    sync,
    render,
    status() { return { mode, seconds: secondsLeft() }; },
  };
  setInterval(render, 1000);
  setInterval(sync, 10000);
  window.addEventListener('focus', sync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  sync();
})();
