// Guided tour engine. Vanilla spotlight: veil bands, highlight ring, step card.
// steps: [{ target, eyebrow, title, body, cta }]. Target is a selector or
// null for a centered card. cta is { label, href } or null.
(function () {
  "use strict";

  const PAD = 10;
  const GAP = 14;

  function el(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  function start(steps, opts) {
    const o = opts || {};
    let index = 0;
    let dead = false;

    const root = el("div", "tour-root", document.body);
    const veil = el("div", "tour-veil", root);
    const ring = el("div", "tour-ring", root);
    const card = el("div", "tour-card", root);
    const brow = el("p", "eyebrow", card);
    const title = el("h3", null, card);
    const body = el("p", "sub", card);
    const ctaRow = el("div", "tour-cta", card);
    const foot = el("div", "tour-foot", card);
    const dots = el("div", "tour-dots", foot);
    const count = el("span", "tour-count", foot);
    const nav = el("div", "tour-nav", foot);
    const backBtn = el("button", "btn-ghost tour-btn", nav);
    backBtn.type = "button";
    backBtn.textContent = "Back";
    const skipBtn = el("button", "btn-ghost tour-btn", nav);
    skipBtn.type = "button";
    skipBtn.textContent = "Skip";
    const nextBtn = el("button", "btn-primary tour-btn", nav);
    nextBtn.type = "button";

    function stop(reason) {
      if (dead) return;
      dead = true;
      window.removeEventListener("resize", layout);
      window.removeEventListener("scroll", layout, true);
      document.removeEventListener("keydown", onKey);
      root.remove();
      if (reason === "done" && typeof o.onDone === "function") o.onDone();
      if (reason === "skip" && typeof o.onSkip === "function") o.onSkip();
    }

    function onKey(ev) {
      if (ev.key === "Escape") stop("skip");
      if (ev.key === "ArrowRight") go(index + 1);
      if (ev.key === "ArrowLeft") go(index - 1);
    }

    function targetRect(step) {
      if (!step.target) return null;
      const t = document.querySelector(step.target);
      if (!t) return null;
      const r = t.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      return r;
    }

    function layout() {
      if (dead) return;
      const step = steps[index];
      const r = targetRect(step);
      veil.textContent = "";
      if (!r) {
        const full = el("div", "tour-band", veil);
        full.style.cssText = "left:0;top:0;width:100vw;height:100vh;";
        ring.hidden = true;
        card.classList.add("center");
        card.style.left = "";
        card.style.top = "";
        return;
      }
      card.classList.remove("center");
      const x = Math.max(0, r.left - PAD);
      const y = Math.max(0, r.top - PAD);
      const w = Math.min(window.innerWidth - x, r.width + PAD * 2);
      const h = Math.min(window.innerHeight - y, r.height + PAD * 2);
      const bands = [
        `left:0;top:0;width:100vw;height:${y}px;`,
        `left:0;top:${y + h}px;width:100vw;height:${Math.max(0, window.innerHeight - y - h)}px;`,
        `left:0;top:${y}px;width:${x}px;height:${h}px;`,
        `left:${x + w}px;top:${y}px;width:${Math.max(0, window.innerWidth - x - w)}px;height:${h}px;`,
      ];
      for (const css of bands) el("div", "tour-band", veil).style.cssText = css;
      ring.hidden = false;
      ring.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
      card.style.visibility = "hidden";
      card.style.left = "0px";
      card.style.top = "0px";
      requestAnimationFrame(() => {
        if (dead) return;
        const cw = Math.min(card.offsetWidth, window.innerWidth - 24);
        const ch = card.offsetHeight;
        let cx = Math.round(Math.min(Math.max(12, x + w / 2 - cw / 2), window.innerWidth - cw - 12));
        let cy = y + h + GAP;
        if (cy + ch > window.innerHeight - 12) cy = Math.max(12, y - GAP - ch);
        card.style.left = `${cx}px`;
        card.style.top = `${cy}px`;
        card.style.visibility = "";
      });
    }

    function paint() {
      const step = steps[index];
      brow.textContent = step.eyebrow || `Step ${index + 1} of ${steps.length}`;
      title.textContent = step.title || "";
      body.textContent = step.body || "";
      ctaRow.textContent = "";
      if (step.cta) {
        const a = document.createElement("a");
        a.className = "btn-primary tour-btn";
        a.textContent = step.cta.label;
        a.href = step.cta.href;
        ctaRow.appendChild(a);
      }
      dots.textContent = "";
      steps.forEach((_, i) => {
        const d = document.createElement("span");
        d.className = i === index ? "on" : "";
        d.textContent = "●";
        dots.appendChild(d);
      });
      count.textContent = `${index + 1} / ${steps.length}`;
      backBtn.disabled = index === 0;
      nextBtn.textContent = index === steps.length - 1 ? "Finish" : "Next";
    }

    function go(i) {
      if (dead) return;
      if (i < 0 || i >= steps.length) {
        stop(i >= steps.length ? "done" : "skip");
        return;
      }
      index = i;
      paint();
      const t = steps[i].target ? document.querySelector(steps[i].target) : null;
      if (t) t.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(layout, 380);
      layout();
    }

    backBtn.addEventListener("click", () => go(index - 1));
    skipBtn.addEventListener("click", () => stop("skip"));
    nextBtn.addEventListener("click", () => go(index + 1));
    window.addEventListener("resize", layout);
    window.addEventListener("scroll", layout, true);
    document.addEventListener("keydown", onKey);
    go(0);
    return { stop };
  }

  window.GuidedTour = { start };
})();
