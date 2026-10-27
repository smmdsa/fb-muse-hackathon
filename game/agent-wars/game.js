// S1 arena demo. This file holds a small standalone sim for the viewer.
// The canonical sim lives in packages/battle-core. This copy mirrors it.

"use strict";

const W = 24;
const H = 16;
const TICK = 1 / 30;
const SPEED = 4;
const RADIUS = 0.35;
const MAX_HP = 100;
const MAX_EN = 100;
const REGEN = 8;
const FIRE_GAP = 0.5;
const SHOT_SPEED = 14;
const SHOT_DMG = 10;
const DASH_COST = 25;
const SHIELD_COST = 20;

const COVERS = [
  { x1: 6.5, y1: 3.5, x2: 8.5, y2: 5.5 },
  { x1: 15.5, y1: 3.5, x2: 17.5, y2: 5.5 },
  { x1: 6.5, y1: 10.5, x2: 8.5, y2: 12.5 },
  { x1: 15.5, y1: 10.5, x2: 17.5, y2: 12.5 },
];

const canvas = document.getElementById("arena");
const ctx = canvas.getContext("2d");
const endcard = document.getElementById("endcard");
const endTitle = document.getElementById("end-title");
const endStats = document.getElementById("end-stats");
const againBtn = document.getElementById("again-btn");

// Slow demo pace when the user prefers reduced motion. Sim math is unchanged.
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const STEP_MS = REDUCED ? 1000 / 6 : 1000 / 30;
const pillTick = document.getElementById("pill-tick");
const pillSeed = document.getElementById("pill-seed");
const pillState = document.getElementById("pill-state");
const pillWinner = document.getElementById("pill-winner");
const hpA = document.getElementById("hp-a");
const hpB = document.getElementById("hp-b");
const enA = document.getElementById("en-a");
const enB = document.getElementById("en-b");
const feed = document.getElementById("feed");
const startBtn = document.getElementById("start-btn");
const restartBtn = document.getElementById("restart-btn");
const pauseBtn = document.getElementById("pause-btn");
const seedInput = document.getElementById("seed");
const promptAInput = document.getElementById("prompt-a");
const promptBInput = document.getElementById("prompt-b");
const dnaLine = document.getElementById("dna-line");

// Compile reads both boxes and reports traits plus rules. Compile is local.
function compileBrains() {
  brains.A = compileSide(promptAInput.value.trim() || "hold position");
  brains.B = compileSide(promptBInput.value.trim() || "hold position");
  const show = (c) => `agg ${c.dna.agg} rules ${c.rules.map((r) => r.id).join(",")}`;
  dnaLine.textContent = `Cyan: ${show(brains.A)} · Crimson: ${show(brains.B)}`;
  note("Compiled: Cyan (" + brains.A.prompt + ") vs Crimson (" + brains.B.prompt + ")");
}

let agents = null;
let shots = [];
let sparks = [];
let tick = 0;
let time = 0;
let over = false;
let winner = null;
let paused = false;
let timer = 0;
let lastA = -10;
let lastB = -10;

function note(text) {
  const li = document.createElement("li");
  li.textContent = "t" + tick + " " + text;
  feed.prepend(li);
  while (feed.children.length > 30) feed.removeChild(feed.lastChild);
}

function hashSeed(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function spawn(side, leftX) {
  const x = side === "A" ? leftX : W - leftX;
  return {
    side,
    x,
    y: H / 2,
    hp: MAX_HP,
    en: MAX_EN,
    ax: x > W / 2 ? -1 : 1,
    ay: 0,
    alive: true,
    shieldUntil: 0,
    shieldCdUntil: 0,
  };
}

function blocked(x1, y1, x2, y2, c) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  if (dx === 0) {
    if (x1 < c.x1 || x1 > c.x2) return false;
  } else {
    let a = (c.x1 - x1) / dx;
    let b = (c.x2 - x1) / dx;
    if (a > b) { const t = a; a = b; b = t; }
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  if (dy === 0) {
    if (y1 < c.y1 || y1 > c.y2) return false;
  } else {
    let a = (c.y1 - y1) / dy;
    let b = (c.y2 - y1) / dy;
    if (a > b) { const t = a; a = b; b = t; }
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

// Local compile. Same keyword map and rule pool as the mock provider.
function traitsFor(text) {
  const p = (text || "").toLowerCase();
  let agg = 50;
  let evd = 50;
  let dist = 50;
  let con = 50;
  if (/attack|aggress|push|rush|brave|kill/.test(p)) agg += 30;
  if (/defen|evad|dodge|flee|run|careful|safe/.test(p)) { evd += 30; agg -= 10; }
  if (/close|near|melee|chase/.test(p)) dist -= 25;
  if (/far|snipe|range|kite|keep away/.test(p)) dist += 25;
  if (/save|conserve|energy|efficient|patient/.test(p)) con += 25;
  if (/dash|waste|spam|reckless/.test(p)) con -= 20;
  const clamp = (n) => Math.min(100, Math.max(0, Math.round(n)));
  return { agg: clamp(agg), evd: clamp(evd), dist: clamp(dist), con: clamp(con) };
}

const RULE_POOL = [
  { id: "weak-retreat", when: { operand: "ownHpPct", op: "lt", value: 25 }, move: "RETREAT" },
  { id: "far-approach", when: { operand: "distFoe", op: "gt", value: 8 }, move: "APPROACH" },
  { id: "mid-strafe", when: { all: [{ operand: "distFoe", op: "gte", value: 4 }, { operand: "distFoe", op: "lte", value: 10 }] }, move: "STRAFE", fire: true },
  { id: "close-fire", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
  { id: "seek-center", when: { operand: "objectiveDist", op: "gt", value: 6 }, move: "CAPTURE" },
  { id: "hide-cover", when: { operand: "coverDist", op: "lt", value: 3 }, move: "SEEK_COVER" },
  { id: "shield-threat", when: { operand: "projectileTti", op: "lt", value: 0.4 }, move: "STRAFE", shield: true },
  { id: "late-push", when: { operand: "timeLeft", op: "lt", value: 20 }, move: "APPROACH", fire: true, dash: true },
];

function compileSide(prompt) {
  const text = prompt || "hold position";
  const dna = traitsFor(text);
  const start = hashSeed(text) % RULE_POOL.length;
  const rules = [0, 1, 2].map((k) => RULE_POOL[(start + k * 3) % RULE_POOL.length]);
  return { prompt: text, dna, rules };
}

let brains = { A: compileSide("evade and snipe from far away"), B: compileSide("rush them down up close") };

function leafVal(obs, operand) {
  switch (operand) {
    case "ownHpPct": return obs.hp;
    case "energy": return obs.en;
    case "distFoe": return obs.los ? obs.dist : null;
    case "projectileTti": return obs.tti;
    case "coverDist": return obs.cover;
    case "timeLeft": return obs.left;
    case "objectiveDist": return obs.obj;
    default: return null;
  }
}

function testPred(when, obs) {
  if (!when || typeof when !== "object") return false;
  if (Array.isArray(when.all)) return when.all.every((k) => testPred(k, obs));
  if (Array.isArray(when.any)) return when.any.some((k) => testPred(k, obs));
  if (when.not) return !testPred(when.not, obs);
  const v = leafVal(obs, when.operand);
  if (v === null || v === undefined) return false;
  if (when.op === "gt") return v > when.value;
  if (when.op === "gte") return v >= when.value;
  if (when.op === "lt") return v < when.value;
  if (when.op === "lte") return v <= when.value;
  return false;
}

// The driver evaluates one side's rules and steers the unit.
function drive(side) {
  const me = agents[side];
  const foe = agents[side === "A" ? "B" : "A"];
  const comp = brains[side];
  const dx = foe.x - me.x;
  const dy = foe.y - me.y;
  const dist = Math.hypot(dx, dy) || 1;
  const los = foe.alive && sightClear(me, foe);
  let tti = null;
  for (const s of shots) {
    if (s.owner === side) continue;
    const t = Math.hypot(s.x - me.x, s.y - me.y) / SHOT_SPEED;
    if (tti === null || t < tti) tti = t;
  }
  let cover = null;
  for (const c of COVERS) {
    const cx = Math.min(Math.max(me.x, c.x1), c.x2);
    const cy = Math.min(Math.max(me.y, c.y1), c.y2);
    const d = Math.hypot(me.x - cx, me.y - cy);
    if (cover === null || d < cover) cover = d;
  }
  const obs = {
    hp: (me.hp / MAX_HP) * 100,
    en: me.en,
    dist,
    los,
    tti,
    cover,
    left: 90 - time,
    obj: Math.hypot(W / 2 - me.x, H / 2 - me.y),
  };
  let pick = { move: "CAPTURE" };
  for (const r of comp.rules) {
    if (testPred(r.when, obs)) { pick = r; break; }
  }
  const flip = ((tick >> 6) % 2) === 1 ? -1 : 1;
  const toFoe = { x: dx / dist, y: dy / dist };
  const toCenter = { x: W / 2 - me.x, y: H / 2 - me.y };
  const cl = Math.hypot(toCenter.x, toCenter.y) || 1;
  toCenter.x /= cl;
  toCenter.y /= cl;
  let mx = 0;
  let my = 0;
  if (pick.move === "APPROACH") { const v = los ? toFoe : toCenter; mx = v.x; my = v.y; }
  else if (pick.move === "RETREAT") { mx = -toFoe.x; my = -toFoe.y; }
  else if (pick.move === "KITE") {
    const blend = obs.dist < 6 ? -0.7 : 0.4;
    mx = toFoe.x * blend + -toFoe.y * flip;
    my = toFoe.y * blend + toFoe.x * flip;
  }
  else if (pick.move === "STRAFE") { mx = -toFoe.y * flip; my = toFoe.x * flip; }
  else if (pick.move === "SEEK_COVER") {
    let best = toCenter;
    let bestD = Infinity;
    for (const c of COVERS) {
      const v = { x: (c.x1 + c.x2) / 2 - me.x, y: (c.y1 + c.y2) / 2 - me.y };
      const d = Math.hypot(v.x, v.y);
      if (d < bestD) { bestD = d; best = v; }
    }
    const l = Math.hypot(best.x, best.y) || 1;
    mx = best.x / l;
    my = best.y / l;
  }
  else { mx = toCenter.x; my = toCenter.y; }
  const w = comp.dna.evd / 100;
  if (tti !== null && tti < 1.2 && comp.dna.evd > 40 && los) {
    const ax = (me.x - foe.x) / dist;
    const ay = (me.y - foe.y) / dist;
    mx = mx * (1 - w) + ax * w;
    my = my * (1 - w) + ay * w;
  }
  let damp = 1;
  if (me.en < 30 && comp.dna.con > 50) damp = 0.6;
  return {
    mx: mx * damp,
    my: my * damp,
    ax: los ? toFoe.x : mx,
    ay: los ? toFoe.y : my,
    fire: pick.fire === true && dist < 12,
    dash: pick.dash === true && me.en > 50,
    shield: pick.shield === true,
  };
}

// Sight breaks when any cover box crosses the view line.
function sightClear(me, foe) {
  for (const c of COVERS) {
    if (blocked(me.x, me.y, foe.x, foe.y, c)) return false;
  }
  return true;
}

function step() {
  if (over || paused) return;
  tick += 1;
  time += TICK;
  const A = agents.A;
  const B = agents.B;
  const pa = drive("A");
  const pb = drive("B");
  move(A, pa);
  move(B, pb);
  shoot(A, pa, "A");
  shoot(B, pb, "B");
  fly();
  if (!A.alive || !B.alive) {
    over = true;
    winner = A.alive ? "A" : B.alive ? "B" : "DRAW";
    note("Battle ends. Winner: " + winner);
    showEnd();
  } else if (tick >= 2700) {
    over = true;
    winner = A.hp === B.hp ? "DRAW" : A.hp > B.hp ? "A" : "B";
    note("Time ends. Winner: " + winner);
    showEnd();
  }
  draw();
  sync();
}

function move(me, p) {
  if (!me.alive) return;
  let sp = SPEED;
  if (p.dash && me.en >= DASH_COST) { sp *= 3.2; me.en -= DASH_COST; }
  if (p.shield && me.en >= SHIELD_COST && time >= me.shieldCdUntil) {
    me.en -= SHIELD_COST;
    me.shieldUntil = time + 0.8;
    me.shieldCdUntil = time + 4;
  }
  me.en = Math.min(MAX_EN, me.en + REGEN * TICK);
  let nx = me.x + p.mx * sp * TICK;
  let ny = me.y + p.my * sp * TICK;
  for (const c of COVERS) {
    const cx = Math.min(Math.max(nx, c.x1), c.x2);
    const cy = Math.min(Math.max(ny, c.y1), c.y2);
    const dx = nx - cx;
    const dy = ny - cy;
    if (dx * dx + dy * dy <= RADIUS * RADIUS && (dx !== 0 || dy !== 0)) {
      const len = Math.hypot(dx, dy) || 0.001;
      nx += (dx / len) * 0.05;
      ny += (dy / len) * 0.05;
    }
  }
  me.x = Math.min(Math.max(nx, RADIUS), W - RADIUS);
  me.y = Math.min(Math.max(ny, RADIUS), H - RADIUS);
  me.ax = p.ax;
  me.ay = p.ay;
}

function shoot(me, p, side) {
  if (!me.alive || !p.fire) return;
  const last = side === "A" ? lastA : lastB;
  if (time - last < FIRE_GAP) return;
  if (side === "A") lastA = time; else lastB = time;
  shots.push({
    owner: side,
    x: me.x + me.ax * 0.5,
    y: me.y + me.ay * 0.5,
    px: me.x,
    py: me.y,
    vx: me.ax * SHOT_SPEED,
    vy: me.ay * SHOT_SPEED,
  });
}

function fly() {
  const out = [];
  for (const s of shots) {
    s.px = s.x;
    s.py = s.y;
    s.x += s.vx * TICK;
    s.y += s.vy * TICK;
    if (s.x < 0 || s.x > W || s.y < 0 || s.y > H) continue;
    let hit = false;
    for (const c of COVERS) {
      if (blocked(s.px, s.py, s.x, s.y, c)) { hit = true; break; }
    }
    if (hit) continue;
    const t = s.owner === "A" ? agents.B : agents.A;
    const dx = s.x - t.x;
    const dy = s.y - t.y;
    if (t.alive && dx * dx + dy * dy <= RADIUS * RADIUS) {
      if (time <= t.shieldUntil) {
        note(s.owner + " shot blocked by shield");
        sparks.push({ x: t.x, y: t.y, age: 0, text: "BLOCK", color: "#ffffff" });
        continue;
      }
      t.hp -= SHOT_DMG;
      note(s.owner + " hits for " + SHOT_DMG);
      sparks.push({ x: t.x, y: t.y, age: 0, text: "-" + SHOT_DMG, color: s.owner === "A" ? "#37e0ff" : "#ff5d7a" });
      flash(t.side);
      if (t.hp <= 0) { t.hp = 0; t.alive = false; }
      continue;
    }
    out.push(s);
  }
  shots = out;
}

function draw() {
  const sx = canvas.width / W;
  const sy = canvas.height / H;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#070b18";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(backdrop(), 0, 0);
  ctx.fillStyle = "#1a2450";
  for (const c of COVERS) {
    ctx.fillRect(c.x1 * sx, c.y1 * sy, (c.x2 - c.x1) * sx, (c.y2 - c.y1) * sy);
    ctx.strokeStyle = "#05070f";
    ctx.strokeRect(c.x1 * sx, c.y1 * sy, (c.x2 - c.x1) * sx, (c.y2 - c.y1) * sy);
  }
  for (const s of shots) {
    ctx.fillStyle = s.owner === "A" ? "#37e0ff" : "#ff5d7a";
    ctx.beginPath();
    ctx.arc(s.x * sx, s.y * sy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  unit(agents.A, "#37e0ff", sx, sy);
  unit(agents.B, "#ff5d7a", sx, sy);
  drawSparks(sx, sy);
}

// The backdrop bakes once: grid field, center zone tint, spawn marks.
let backCanvas = null;
function backdrop() {
  if (backCanvas) return backCanvas;
  backCanvas = document.createElement("canvas");
  backCanvas.width = canvas.width;
  backCanvas.height = canvas.height;
  const g = backCanvas.getContext("2d");
  const sx = backCanvas.width / W;
  const sy = backCanvas.height / H;
  g.fillStyle = "#070b18";
  g.fillRect(0, 0, backCanvas.width, backCanvas.height);
  g.strokeStyle = "#131a36";
  g.lineWidth = 1;
  for (let x = 1; x < W; x += 1) {
    g.beginPath();
    g.moveTo(x * sx, 0);
    g.lineTo(x * sx, backCanvas.height);
    g.stroke();
  }
  for (let y = 1; y < H; y += 1) {
    g.beginPath();
    g.moveTo(0, y * sy);
    g.lineTo(backCanvas.width, y * sy);
    g.stroke();
  }
  g.fillStyle = "#37e0ff14";
  g.fillRect(W / 2 * sx - 2 * sx, H / 2 * sy - 2 * sy, 4 * sx, 4 * sy);
  g.strokeStyle = "#37e0ff55";
  g.strokeRect(W / 2 * sx - 2 * sx, H / 2 * sy - 2 * sy, 4 * sx, 4 * sy);
  g.fillStyle = "#9aa6d0";
  g.fillRect(2 * sx - 3, H / 2 * sy - 3, 6, 6);
  g.fillRect((W - 2) * sx - 3, H / 2 * sy - 3, 6, 6);
  return backCanvas;
}

// Hit sparks rise and fade. The list clears on every reset.
function drawSparks(sx, sy) {
  const keep = [];
  for (const p of sparks) {
    p.age += 1;
    if (p.age > 24) continue;
    keep.push(p);
    const k = 1 - p.age / 24;
    ctx.globalAlpha = k;
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 13px 'Chakra Petch', sans-serif";
    ctx.fillText(p.text, p.x * sx + 8, p.y * sy - p.age);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x * sx - 2, p.y * sy - 2 - p.age / 2, 4, 4);
    ctx.globalAlpha = 1;
  }
  sparks = keep;
}

function unit(me, color, sx, sy) {
  if (!me.alive) return;
  ctx.fillStyle = "#05070f";
  ctx.beginPath();
  ctx.ellipse(me.x * sx, me.y * sy + 12, 12, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.strokeStyle = "#05070f";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(me.x * sx, me.y * sy, RADIUS * sx, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(me.x * sx, me.y * sy);
  ctx.lineTo((me.x + me.ax) * sx, (me.y + me.ay) * sy);
  ctx.stroke();
}

function sync() {
  pillTick.textContent = "tick " + tick;
  hpA.style.width = (agents.A.hp / MAX_HP) * 100 + "%";
  hpB.style.width = (agents.B.hp / MAX_HP) * 100 + "%";
  enA.style.width = (agents.A.en / MAX_EN) * 100 + "%";
  enB.style.width = (agents.B.en / MAX_EN) * 100 + "%";
}

// The HP bar flashes white on a hit. The class clears after 120 ms.
function flash(side) {
  const el = side === "A" ? hpA : hpB;
  el.classList.add("hit");
  window.setTimeout(() => el.classList.remove("hit"), 120);
}

// The end screen sits over the scene with the result and the stats.
function showEnd() {
  const name = winner === "A" ? "Cyan" : winner === "B" ? "Crimson" : null;
  endTitle.textContent = name ? name + " wins" : "Draw";
  endStats.textContent = tick + " ticks · seed " + (seedInput.value.trim() || "forge-001");
  pillWinner.textContent = "winner: " + (winner || "DRAW");
  pillState.textContent = "done";
  endcard.hidden = false;
}

function reset(seed) {
  const mirror = hashSeed(seed || "forge-001") % 2 === 1;
  const leftX = mirror ? W - 2 : 2;
  agents = { A: spawn("A", leftX), B: spawn("B", leftX) };
  pillSeed.textContent = "seed " + (seed || "forge-001") + (mirror ? " · mirrored" : " · straight");
  shots = [];
  tick = 0;
  time = 0;
  over = false;
  winner = null;
  paused = false;
  lastA = -10;
  lastB = -10;
  feed.innerHTML = "";
  pillWinner.textContent = "no winner yet";
  sparks = [];
  endcard.hidden = true;
}

startBtn.addEventListener("click", () => {
  const seed = seedInput.value.trim() || "forge-001";
  reset(seed);
  compileBrains();
  note("Battle starts: Cyan vs Crimson");
  pillState.textContent = "live";
  startBtn.disabled = true;
  restartBtn.disabled = false;
  pauseBtn.disabled = false;
  pauseBtn.textContent = "Pause";
  clearInterval(timer);
  timer = setInterval(step, STEP_MS);
  draw();
  sync();
});

restartBtn.addEventListener("click", () => {
  reset(seedInput.value.trim() || "forge-001");
  compileBrains();
  note("Battle restarts");
  pillState.textContent = "live";
  pauseBtn.textContent = "Pause";
  clearInterval(timer);
  timer = setInterval(step, STEP_MS);
});

againBtn.addEventListener("click", () => {
  reset(seedInput.value.trim() || "forge-001");
  compileBrains();
  note("Battle restarts");
  pillState.textContent = "live";
  pauseBtn.textContent = "Pause";
  clearInterval(timer);
  timer = setInterval(step, STEP_MS);
  draw();
  sync();
});

pauseBtn.addEventListener("click", () => {
  paused = !paused;
  pauseBtn.textContent = paused ? "Resume" : "Pause";
  pillState.textContent = paused ? "paused" : "live";
});
