// Shared AI factory cooldown. The server remains authoritative across tabs and devices.
(() => {
  const selector = '[data-factory-control], .factory-analysis';
  let until = 0;
  let checked = false;
  let busy = false;
  let error = false;
  const locked = new WeakMap();
  const message = document.createElement('p');
  message.className = 'sub factory-cooldown';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  const mount = document.querySelector('#train-card') || document.querySelector('#breed-card') || document.querySelector('main');
  if (mount) mount.prepend(message);

  function render() {
    const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    const blocked = !checked || busy || error || seconds > 0;
    for (const el of document.querySelectorAll(selector)) {
      if (blocked) {
        if (!locked.has(el)) locked.set(el, el.disabled);
        el.disabled = true;
      } else if (locked.has(el)) {
        el.disabled = locked.get(el) || (el.id === 'compile-btn' && !window.factoryAgentReady);
        locked.delete(el);
      }
    }
    if (busy) message.textContent = 'AI FACTORY · Building your request…';
    else if (error) message.textContent = 'AI FACTORY · Status unavailable. Reconnecting before the next build…';
    else if (!checked) message.textContent = 'AI FACTORY · Checking the assembly bay…';
    else if (seconds) message.textContent = `AI FACTORY · Assembly bay cooling down. Next build in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.`;
    else message.textContent = 'AI FACTORY · Assembly bay ready.';
  }
  async function sync() {
    const token = localStorage.getItem('aw_token');
    if (!token) { checked = true; error = false; render(); return; }
    try {
      const res = await fetch('/v1/ai/cooldown', { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('status unavailable');
      const data = await res.json();
      until = Date.now() + Math.max(0, Number(data.retryAfterSeconds) || 0) * 1000;
      checked = true; error = false;
    } catch { checked = true; error = true; }
    render();
  }
  function aiPath(method, path) {
    return method === 'POST' && (path === '/v1/agents' || /\/policies\/compile$|\/portrait\/retry$|\/analysis$/.test(path));
  }
  window.factoryCooldown = {
    start(method, path) { if (aiPath(method, path)) { busy = true; render(); } },
    async finish(method, path) { if (aiPath(method, path)) { await sync(); busy = false; render(); } },
    sync,
    render,
  };
  setInterval(render, 1000);
  setInterval(sync, 10000);
  window.addEventListener('focus', sync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  sync();
})();
