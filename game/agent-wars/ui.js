// Shared UI helpers: toast + modal. No game logic, no API calls.
(function () {
  "use strict";
  let toastTimer = 0;

  function ensureToast() {
    let t = document.getElementById("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.className = "toast";
      t.setAttribute("role", "status");
      t.hidden = true;
      document.body.appendChild(t);
    }
    return t;
  }

  function toast(msg) {
    const t = ensureToast();
    t.textContent = String(msg);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
  }

  function closeModal() {
    const m = document.getElementById("modal");
    if (m) m.remove();
  }

  // actions: [{ label, primary, onClick }]. First action style: primary when flagged.
  function showModal(opts) {
    closeModal();
    const m = document.createElement("div");
    m.id = "modal";
    m.className = "modal";
    const d = document.createElement("div");
    d.className = "dialog";
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-modal", "true");
    if (opts.eyebrow) {
      const e = document.createElement("p");
      e.className = "eyebrow";
      e.textContent = opts.eyebrow;
      d.appendChild(e);
    }
    const h = document.createElement("h2");
    h.textContent = opts.title || "";
    d.appendChild(h);
    if (opts.body) {
      const p = document.createElement("p");
      p.className = "sub";
      p.textContent = opts.body;
      d.appendChild(p);
    }
    const row = document.createElement("div");
    row.className = "next-actions";
    for (const a of opts.actions || [{ label: "Close" }]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = a.primary ? "btn-primary" : "btn-ghost";
      b.textContent = a.label;
      b.addEventListener("click", () => {
        closeModal();
        if (typeof a.onClick === "function") a.onClick();
      });
      row.appendChild(b);
    }
    d.appendChild(row);
    m.appendChild(d);
    m.addEventListener("click", (ev) => { if (ev.target === m) closeModal(); });
    document.body.appendChild(m);
  }

  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeModal(); });
  window.toast = toast;
  window.showModal = showModal;
  window.closeModal = closeModal;
})();
