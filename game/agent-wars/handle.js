// First-time handle claim. One page, one name, one celebration.
// The local rules mirror packages/auth/src/handle.ts. The server
// rechecks everything, and the UNIQUE index wins every race.

const $ = (id) => document.getElementById(id);

const RULE = /^[a-z][a-z0-9_]{2,15}$/;
const RESERVED = new Set([
  "admin", "administrator", "agentwars", "api", "mod", "moderator",
  "null", "official", "support", "system", "undefined", "wallet",
]);

let ready = false;
let probeSeq = 0;
let probeTimer = 0;

async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...window.AWSession.authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function say(msg) {
  $("handle-status").textContent = msg;
}

function mark(kind) {
  const input = $("handle-input");
  input.classList.toggle("ok", kind === "ok");
  input.classList.toggle("bad", kind === "bad");
}

function normalize(raw) {
  return raw.trim().toLowerCase();
}

function localError(name) {
  if (!RULE.test(name)) return "use 3-16 chars: a-z, 0-9, underscore, starting with a letter";
  if (RESERVED.has(name)) return "that name is reserved";
  return null;
}

async function probe() {
  const seq = ++probeSeq;
  const name = normalize($("handle-input").value);
  $("claim-btn").disabled = true;
  if (!name) {
    say("Type the name you want.");
    mark("");
    return;
  }
  const invalid = localError(name);
  if (invalid) {
    say(invalid);
    mark("bad");
    return;
  }
  say("Checking…");
  mark("");
  const r = await call("GET", `/v1/handles/available?name=${encodeURIComponent(name)}`);
  if (seq !== probeSeq) return; // A newer keystroke owns the line.
  if (r.status !== 200) {
    say("Could not check that name. Try again.");
    return;
  }
  if (!r.data.available) {
    say(r.data.error || "that name is taken");
    mark("bad");
    return;
  }
  say(`${name} is available.`);
  mark("ok");
  $("claim-btn").disabled = false;
}

function scheduleProbe() {
  window.clearTimeout(probeTimer);
  probeTimer = window.setTimeout(probe, 250);
}

function confetti(canvas) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const fit = () => {
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
  };
  fit();
  window.addEventListener("resize", fit);
  const colors = ["#8affec", "#ffd166", "#ff5d7a", "#3dff7a", "#c39bff"];
  const parts = Array.from({ length: 140 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.3,
    w: (5 + Math.random() * 6) * dpr,
    h: (8 + Math.random() * 8) * dpr,
    vx: (Math.random() - 0.5) * 2 * dpr,
    vy: (2 + Math.random() * 3) * dpr,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.2,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const start = performance.now();
  function frame(now) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (now - start < 4000) {
      requestAnimationFrame(frame);
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    window.removeEventListener("resize", fit);
    canvas.remove();
  }
  requestAnimationFrame(frame);
}

async function claim() {
  const name = normalize($("handle-input").value);
  const invalid = localError(name);
  if (invalid) {
    say(invalid);
    return;
  }
  $("claim-btn").disabled = true;
  say("Claiming…");
  const r = await call("POST", "/v1/me/handle", { handle: name });
  if (r.status === 200) {
    $("handle-card").hidden = true;
    $("handle-name").textContent = r.data.handle || name;
    $("handle-done").hidden = false;
    $("pill-who").textContent = r.data.handle || name;
    const canvas = $("confetti");
    canvas.hidden = false;
    confetti(canvas);
    if (typeof window.toast === "function") window.toast("Handle claimed.");
    return;
  }
  if (r.status === 409) {
    say("Someone just took that name. Try another.");
    mark("bad");
    return;
  }
  say(r.data.error || "Claim failed. Try again.");
  $("claim-btn").disabled = false;
}

async function boot() {
  const me = await call("GET", "/v1/me");
  if (me.status === 401) {
    location.replace("./auth.html?next=handle.html");
    return;
  }
  if (me.status === 200 && me.data && me.data.handleSet === true) {
    location.replace("./profile.html"); // The name exists. No second pick.
    return;
  }
  if (me.status !== 200) {
    say("Could not reach the server. Reload to retry.");
    return;
  }
  ready = true;
  $("handle-input").disabled = false;
  say("Type the name you want.");
  $("handle-input").focus();
}

$("handle-input").addEventListener("input", () => {
  if (ready) scheduleProbe();
});
$("claim-btn").addEventListener("click", () => {
  if (ready) claim();
});

boot();
