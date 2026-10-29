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
const speedBtn = document.getElementById("speed-btn");
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
  if (p.dash && me.en >= DASH_COST) {
    sp *= 3.2;
    me.en -= DASH_COST;
    sparks.push({ x: me.x, y: me.y, age: 0, text: "DASH", color: "#ffffff" });
  }
  if (p.shield && me.en >= SHIELD_COST && time >= me.shieldCdUntil) {
    me.en -= SHIELD_COST;
    me.shieldUntil = time + 0.8;
    me.shieldCdUntil = time + 4;
    note((me.side === "A" ? "Cyan" : "Crimson") + " raises shield");
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
function drawSparks(sx, sy, oy) {
  const off = oy || 0;
  const keep = [];
  for (const p of sparks) {
    p.age += 1;
    if (p.age > 24) continue;
    keep.push(p);
    const k = 1 - p.age / 24;
    ctx.globalAlpha = k;
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 13px 'Chakra Petch', sans-serif";
    ctx.fillText(p.text, p.x * sx + 8, p.y * sy + off - p.age);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x * sx - 2, p.y * sy + off - 2 - p.age / 2, 4, 4);
    ctx.globalAlpha = 1;
  }
  sparks = keep;
}

function unit(me, color, sx, sy) {
  if (!me.alive) {
    ctx.strokeStyle = "#3a4568";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(me.x * sx - 8, me.y * sy - 8);
    ctx.lineTo(me.x * sx + 8, me.y * sy + 8);
    ctx.moveTo(me.x * sx + 8, me.y * sy - 8);
    ctx.lineTo(me.x * sx - 8, me.y * sy + 8);
    ctx.stroke();
    return;
  }
  const px = me.x * sx;
  const py = me.y * sy;
  const ang = Math.atan2(me.ay || 0, me.ax || 1);
  ctx.fillStyle = "#05070f";
  ctx.beginPath();
  ctx.ellipse(px, py + 12, 13, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(ang);
  ctx.fillStyle = "#141b33";
  ctx.strokeStyle = "#05070f";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-13, -10, 26, 20, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-13, -10, 26, 7, 3);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(4, -3, 7, 6);
  ctx.fillStyle = "#05070f";
  ctx.fillRect(-14, -3, 5, 6);
  ctx.fillRect(11, -12, 4, 5);
  ctx.fillRect(11, 7, 4, 5);
  ctx.restore();
  const low = me.hp / MAX_HP < 0.3;
  if (low) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(px, py, RADIUS * sx + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (time <= me.shieldUntil) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, RADIUS * sx + 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(px, py, RADIUS * sx + 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function sync() {
  pillTick.textContent = "tick " + tick;
  hpA.style.width = (agents.A.hp / MAX_HP) * 100 + "%";
  hpB.style.width = (agents.B.hp / MAX_HP) * 100 + "%";
  enA.style.width = (agents.A.en / MAX_EN) * 100 + "%";
  enB.style.width = (agents.B.en / MAX_EN) * 100 + "%";
  const clock = document.getElementById("arena-clock");
  if (clock) clock.textContent = String(Math.max(0, Math.ceil(90 - time)));
  const compact = document.getElementById("diag-compact");
  if (compact) compact.textContent = "local sim · " + tick + " ticks";
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
  const lead = winner === "DRAW" ? "Draw" : name ? name + " wins" : "Draw";
  endTitle.textContent = lead;
  const aHp = agents && agents.A ? Math.max(0, Math.round(agents.A.hp)) : 0;
  const bHp = agents && agents.B ? Math.max(0, Math.round(agents.B.hp)) : 0;
  endStats.textContent = `${tick} ticks · Cyan ${aHp} HP — Crimson ${bHp} HP`;
  const econ = document.getElementById("end-econ");
  if (econ) econ.textContent = "Sandbox sparring — no rank change.";
  pillWinner.textContent = "winner: " + (winner || "DRAW");
  pillState.textContent = "done";
  endcard.hidden = false;
}

function reset(seed) {
  stopMoba();
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

if (speedBtn) {
  speedBtn.addEventListener("click", () => {
    replaySpeed = SPEEDS[(SPEEDS.indexOf(replaySpeed) + 1) % SPEEDS.length];
    speedBtn.textContent = `Speed ${replaySpeed}x`;
  });
}

// Server replay playback. Frames come from GET /v1/matches/:id/replay.
// Frames sample one fight every 9 ticks, so each frame holds 300 ms of
// fight time. Playback honors fight time: robots glide between frames
// instead of teleporting, and the clock runs at true speed.
const REPLAY_EVERY = 9;
const FRAME_MS = REPLAY_EVERY * 1000 * TICK;
const SPEEDS = [1, 2, 4];
let replayFrames = null;
let replayIdx = 0;
let replayPrev = null;
let replayCurr = null;
let replayAlpha = 0;
let replaySpeed = 1;
let replayMeta = null;

function faceDelta(c, p) {
  const dx = c - p;
  if (dx > 0.001) return 1;
  if (dx < -0.001) return -1;
  return 0;
}

function playServerReplay(replay, meta) {
  clearInterval(timer);
  if (replay && replay.version === 2 && replay.mode === "moba") {
    playMobaReplay(replay, meta);
    return;
  }
  stopMoba();
  replayFrames = replay.frames || [];
  replayIdx = 1;
  replayPrev = replayFrames[0] || null;
  replayCurr = replayFrames[0] || null;
  replayAlpha = 0;
  replayMeta = meta || {};
  shots = [];
  sparks = [];
  over = true;
  paused = false;
  winner = null;
  pillSeed.textContent = "seed " + (replay.seed || "server");
  pillState.textContent = "replay";
  pillWinner.textContent = "winner: —";
  endcard.hidden = true;
  feed.innerHTML = "";
  note("Server replay loads: " + replayFrames.length + " frames at " + replaySpeed + "x");
  pauseBtn.disabled = false;
  pauseBtn.textContent = "Pause";
  timer = setInterval(playStep, STEP_MS);
}

function playStep() {
  if (moba) {
    mobaStep();
    return;
  }
  if (paused || !replayFrames || !replayCurr) return;
  if (replayIdx >= replayFrames.length && replayAlpha >= FRAME_MS) {
    clearInterval(timer);
    finishReplay();
    return;
  }
  replayAlpha += STEP_MS * replaySpeed;
  while (replayAlpha >= FRAME_MS && replayIdx < replayFrames.length) {
    replayAlpha -= FRAME_MS;
    replayPrev = replayCurr;
    replayCurr = replayFrames[replayIdx];
    replayIdx += 1;
    if (replayCurr.ahp < replayPrev.ahp) flash("A");
    if (replayCurr.bhp < replayPrev.bhp) flash("B");
  }
  const t = replayFrames.length ? Math.min(1, replayAlpha / FRAME_MS) : 1;
  const glide = (p, c) => p + (c - p) * t;
  const p = replayPrev || replayCurr;
  const f = replayCurr;
  let fxA = faceDelta(f.ax, p.ax);
  let fyA = faceDelta(f.ay, p.ay);
  if (fxA === 0 && fyA === 0) { fxA = 1; fyA = 0; }
  let fxB = faceDelta(f.bx, p.bx);
  let fyB = faceDelta(f.by, p.by);
  if (fxB === 0 && fyB === 0) { fxB = -1; fyB = 0; }
  agents = {
    A: { side: "A", x: glide(p.ax, f.ax), y: glide(p.ay, f.ay), hp: f.ahp, en: f.aen, ax: fxA, ay: fyA, alive: f.ahp > 0 },
    B: { side: "B", x: glide(p.bx, f.bx), y: glide(p.by, f.by), hp: f.bhp, en: f.ben, ax: fxB, ay: fyB, alive: f.bhp > 0 },
  };
  tick = f.t;
  time = f.t * TICK;
  draw();
  sync();
}

function finishReplay() {
  if (moba) {
    finishMoba();
    return;
  }
  const m = replayMeta || {};
  winner = m.winner || null;
  hideRecap();
  const ok = m.checksumOk ? "checksum verified" : "checksum MISMATCH";
  endTitle.textContent = winner === "A" ? "Cyan wins" : winner === "B" ? "Crimson wins" : "Draw";
  endStats.textContent = (m.ticks ?? tick) + " ticks · " + ok;
  const econ = document.getElementById("end-econ");
  if (econ) econ.textContent = m.econ ? String(m.econ) : "";
  pillWinner.textContent = "winner: " + (winner || "DRAW");
  pillState.textContent = "done";
  endcard.hidden = false;
  note("Replay ends. " + endTitle.textContent + ". " + ok + ".");
  replayFrames = null;
  replayMeta = null;
}

window.playServerReplay = playServerReplay;

// ---- MOBA viewer (ReplayV2). Frames render. Nothing re-simulates. ----
// Spec numbers come from specs/moba-spec.md. The viewer never imports
// battle-core. Projectiles are cosmetic: HP drops between frames spawn
// tracers from the nearest in-range foe, so every wound shows a bullet.

const MW = 48;
const MH = 16;
const MOBA_LANE_Y = 8;
const MOBA_ROBOT_RANGE = 4.0;
const MOBA_TOWER_RANGE = 4.8;
const MOBA_CASTER_RANGE = 2.5;
const MOBA_MELEE_RANGE = 1.0;
const MOBA_BOLT_SPEED = 14;
const MOBA_COLOR = { A: "#37e0ff", B: "#ff5d7a" };

const MOBA_COVERS = [
  { x1: 19.5, y1: 3.0, x2: 21.5, y2: 5.0 },
  { x1: 26.5, y1: 3.0, x2: 28.5, y2: 5.0 },
  { x1: 19.5, y1: 11.0, x2: 21.5, y2: 13.0 },
  { x1: 26.5, y1: 11.0, x2: 28.5, y2: 13.0 },
];

const MOBA_POS = {
  nexus: { x: 2.0, y: 8.0 },
  nt_top: { x: 7.0, y: 6.4 },
  nt_bot: { x: 7.0, y: 9.6 },
  inhib: { x: 12.5, y: 8.0 },
  t2: { x: 17.5, y: 8.0 },
  t1: { x: 22.5, y: 8.0 },
};

const MOBA_MAXHP = { t1: 1200, t2: 1500, inhib: 800, nt_top: 900, nt_bot: 900, nexus: 1200 };
const MOBA_RADIUS = { nexus: 0.9, t1: 0.6, t2: 0.6, inhib: 0.6, nt_top: 0.6, nt_bot: 0.6 };

let moba = null;

// The ring loads once. Draw uses it only when fully loaded.
const mobaRing = new Image();
mobaRing.src = "./assets/moba/arena_ring.png";

// Item icons resolve through the MOBA manifest. A miss falls
// back to the plain file name, so old paths keep working.
let mobaIcons = null;
fetch("./assets/moba/manifest.json")
  .then((r) => (r.ok ? r.json() : null))
  .then((m) => { if (m && m.assets) mobaIcons = m.assets; })
  .catch(() => { mobaIcons = null; });

function mobaIcon(item) {
  const hit = mobaIcons && mobaIcons[item];
  const file = hit && hit.file ? hit.file : item + ".png";
  return "./assets/moba/" + file;
}

// Roster names and total gold costs. Spec section 6.2 fixes each value.
const MOBA_ITEM_NAME = {
  scrap_blade: "Scrap Blade",
  cloth_weave: "Cloth Weave",
  worn_treads: "Worn Treads",
  overclock_chip: "Overclock Chip",
  hull_patch: "Hull Patch",
  repair_cell: "Repair Cell",
  tempered_edge: "Tempered Edge",
  bulwark_plate: "Bulwark Plate",
  turbo_treads: "Turbo Treads",
  rapid_cycler: "Rapid Cycler",
  reinforced_hull: "Reinforced Hull",
  siege_breaker: "Siege Breaker",
  aegis_core: "Aegis Core",
  phantom_drive: "Phantom Drive",
  warlord_frame: "Warlord Frame",
};

const MOBA_ITEM_TOTAL = {
  scrap_blade: 250,
  cloth_weave: 250,
  worn_treads: 250,
  overclock_chip: 300,
  hull_patch: 300,
  repair_cell: 50,
  tempered_edge: 600,
  bulwark_plate: 600,
  turbo_treads: 600,
  rapid_cycler: 650,
  reinforced_hull: 650,
  siege_breaker: 1650,
  aegis_core: 1650,
  phantom_drive: 1650,
  warlord_frame: 1650,
};

const MOBA_START_GOLD = 350;

function mobaKey(id) {
  return String(id).slice(2);
}

function mobaSideOf(id) {
  return String(id).charAt(0) === "a" ? "A" : "B";
}

function mobaStructPos(id) {
  const p = MOBA_POS[mobaKey(id)];
  const x = mobaSideOf(id) === "A" ? p.x : MW - p.x;
  return { x, y: p.y };
}

function mobaKindOf(id) {
  const k = mobaKey(id);
  if (k === "t1" || k === "t2") return "tower";
  if (k === "inhib") return "inhibitor";
  if (k === "nexus") return "nexus";
  return "nexus_turret";
}

// Gating chain per side: t1 -> t2 -> inhib -> nexus turrets -> nexus.
// The Nexus needs one Nexus turret down. Dead means hp <= 0.
function mobaVulnerable(id, hpById) {
  const p = mobaSideOf(id) === "A" ? "a" : "b";
  const k = mobaKey(id);
  const dead = (suf) => (hpById[p + "_" + suf] || 0) <= 0;
  if (k === "t1") return true;
  if (k === "t2") return dead("t1");
  if (k === "inhib") return dead("t2");
  if (k === "nt_top" || k === "nt_bot") return dead("inhib");
  return dead("nt_top") || dead("nt_bot");
}

function mobaClock(ticks) {
  const s = Math.max(0, Math.floor(ticks * TICK));
  const m = Math.floor(s / 60);
  return m + ":" + String(s % 60).padStart(2, "0");
}

function mobaFeed(text, cls) {
  const list = document.getElementById("moba-feed");
  if (!list) return;
  const li = document.createElement("li");
  if (cls) li.className = cls;
  li.textContent = text;
  list.prepend(li);
  while (list.children.length > 30) list.removeChild(list.lastChild);
}

function stopMoba() {
  moba = null;
  hideRecap();
  const hud = document.getElementById("moba-hud");
  if (hud) hud.hidden = true;
  const unit = document.getElementById("arena-clock-unit");
  if (unit) unit.textContent = "s";
}

// The recap clears on every new replay. Duel replays never show it.
function hideRecap() {
  const el = document.getElementById("end-builds");
  if (el) {
    el.hidden = true;
    el.innerHTML = "";
  }
}

function playMobaReplay(replay, meta) {
  const frames = replay.frames || [];
  moba = {
    frames,
    events: (replay.events || []).slice().sort((x, y) => x.t - y.t),
    evIdx: 0,
    order: replay.structures || [],
    idx: 1,
    prev: frames[0] || null,
    curr: frames[0] || null,
    structs: null,
    buildsA: [],
    buildsB: [],
    maxA: 550,
    maxB: 550,
    bolts: [],
    tracers: [],
    beam: null,
    beamLeft: 0,
    faceA: { x: 1, y: 0 },
    faceB: { x: -1, y: 0 },
    minLast: new Map(),
    meta: meta || {},
    nexusDead: null,
  };
  replayAlpha = 0;
  shots = [];
  sparks = [];
  over = true;
  paused = false;
  winner = null;
  if (frames[0]) {
    if (frames[0].structs) moba.structs = frames[0].structs.slice();
    mobaBuildsFrom(frames[0]);
    for (const mn of frames[0].minions || []) moba.minLast.set(mn.id, { x: mn.x, y: mn.y, side: mn.side });
  }
  pillSeed.textContent = "seed " + (replay.seed || "server");
  pillState.textContent = "replay";
  pillWinner.textContent = "winner: —";
  endcard.hidden = true;
  hideRecap();
  feed.innerHTML = "";
  const mf = document.getElementById("moba-feed");
  if (mf) mf.innerHTML = "";
  const hud = document.getElementById("moba-hud");
  if (hud) hud.hidden = false;
  const unit = document.getElementById("arena-clock-unit");
  if (unit) unit.textContent = "";
  note("MOBA replay loads: " + frames.length + " frames at " + replaySpeed + "x");
  pauseBtn.disabled = false;
  pauseBtn.textContent = "Pause";
  mobaReveal(0);
  mobaSyncHud();
  drawMoba(1);
  syncMoba();
  timer = setInterval(playStep, STEP_MS);
}

function mobaBuildsFrom(f) {
  if (!moba || !f) return;
  if (f.builds) {
    moba.buildsA = f.builds.a || [];
    moba.buildsB = f.builds.b || [];
  } else {
    if (f.a && f.a.items) moba.buildsA = f.a.items.slice();
    if (f.b && f.b.items) moba.buildsB = f.b.items.slice();
  }
}

function mobaHpById() {
  const out = {};
  if (!moba || !moba.order) return out;
  for (let i = 0; i < moba.order.length; i += 1) {
    out[moba.order[i]] = moba.structs ? moba.structs[i] : 0;
  }
  return out;
}

function mobaStep() {
  if (paused || !moba || !moba.curr) return;
  if (moba.idx >= moba.frames.length && replayAlpha >= FRAME_MS) {
    clearInterval(timer);
    finishReplay();
    return;
  }
  replayAlpha += STEP_MS * replaySpeed;
  while (replayAlpha >= FRAME_MS && moba.idx < moba.frames.length) {
    replayAlpha -= FRAME_MS;
    moba.prev = moba.curr;
    moba.curr = moba.frames[moba.idx];
    moba.idx += 1;
    mobaOnFrame(moba.prev, moba.curr);
  }
  const f = moba.curr;
  const fxA = faceDelta(f.a.x, moba.prev.a.x);
  const fyA = faceDelta(f.a.y, moba.prev.a.y);
  if (fxA !== 0 || fyA !== 0) moba.faceA = { x: fxA, y: fyA };
  const fxB = faceDelta(f.b.x, moba.prev.b.x);
  const fyB = faceDelta(f.b.y, moba.prev.b.y);
  if (fxB !== 0 || fyB !== 0) moba.faceB = { x: fxB, y: fyB };
  mobaFly(STEP_MS * replaySpeed / 1000);
  tick = f.t;
  time = f.t * TICK;
  const t = Math.min(1, replayAlpha / FRAME_MS);
  drawMoba(t);
  syncMoba();
}

function mobaOnFrame(p, f) {
  if (f.a.hp < p.a.hp) flash("A");
  if (f.b.hp < p.b.hp) flash("B");
  if (f.structs) {
    const before = moba.structs || f.structs.slice();
    moba.structs = f.structs.slice();
    for (let i = 0; i < f.structs.length; i += 1) {
      if (f.structs[i] < before[i] && f.structs[i] <= 0) {
        const id = moba.order[i];
        const pos = mobaStructPos(id);
        sparks.push({ x: pos.x, y: pos.y, age: 0, text: "DOWN", color: "#ffffff" });
        if (mobaKey(id) === "nexus") {
          moba.beam = { x: pos.x, y: pos.y, side: mobaSideOf(id) };
          moba.beamLeft = 2.5;
          moba.nexusDead = id;
        }
      }
    }
  }
  mobaBuildsFrom(f);
  moba.maxA = Math.max(moba.maxA, f.a.hp);
  moba.maxB = Math.max(moba.maxB, f.b.hp);
  // Robot deaths burst at the death site.
  if (p.a.alive && !f.a.alive) sparks.push({ x: f.a.x, y: f.a.y, age: 0, text: "KO", color: MOBA_COLOR.B });
  if (p.b.alive && !f.b.alive) sparks.push({ x: f.b.x, y: f.b.y, age: 0, text: "KO", color: MOBA_COLOR.A });
  // Vanished minions died: pop a spark at the last known spot.
  const now = new Map();
  for (const mn of f.minions || []) now.set(mn.id, mn);
  for (const [id, last] of moba.minLast) {
    if (!now.has(id)) sparks.push({ x: last.x, y: last.y, age: 0, text: "x", color: MOBA_COLOR[last.side] });
  }
  moba.minLast = new Map();
  for (const mn of f.minions || []) moba.minLast.set(mn.id, { x: mn.x, y: mn.y, side: mn.side });
  mobaSpawnBolts(p, f);
  mobaReveal(f.t);
  mobaSyncHud();
}

function mobaReveal(until) {
  while (moba.evIdx < moba.events.length && moba.events[moba.evIdx].t <= until) {
    const e = moba.events[moba.evIdx];
    moba.evIdx += 1;
    const clock = mobaClock(e.t);
    const name = (s) => (s === "A" ? "Cyan" : "Crimson");
    if (e.type === "wave") note("t" + e.t + " wave spawns for " + name(e.side));
    else if (e.type === "buy") {
      note("t" + e.t + " " + name(e.side) + " buys " + e.item + " (" + e.gold + "g left)");
      mobaFeed(clock + "  " + name(e.side) + " buys " + (MOBA_ITEM_NAME[e.item] || e.item) + " (" + e.gold + "g left)", "econ");
    } else if (e.type === "combine") {
      note("t" + e.t + " " + name(e.side) + " forges " + e.item);
      mobaFeed(clock + "  " + name(e.side) + " forges " + (MOBA_ITEM_NAME[e.item] || e.item), "econ");
    }
    else if (e.type === "kill") {
      mobaFeed(clock + "  " + name(e.side) + " robot destroyed", "kill");
      note("t" + e.t + " " + name(e.side) + " robot dies");
    } else if (e.type === "respawn") {
      mobaFeed(clock + "  " + name(e.side) + " robot respawns", "");
      note("t" + e.t + " " + name(e.side) + " robot respawns");
    } else if (e.type === "structure") {
      const isNexus = mobaKey(e.id) === "nexus";
      mobaFeed(clock + "  " + name(e.side) + " " + e.id + " destroyed" + (isNexus ? " — NEXUS" : ""), isNexus ? "nexus" : "kill");
      note("t" + e.t + " structure falls: " + e.id);
    }
  }
}

function mobaSyncHud() {
  const f = moba.curr;
  if (!f) return;
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set("gold-a", (f.a.gold || 0) + "g");
  set("gold-b", (f.b.gold || 0) + "g");
  const ra = document.getElementById("respawn-a");
  if (ra) {
    ra.hidden = f.a.alive;
    if (!f.a.alive) ra.textContent = "respawn " + Math.ceil((f.a.respawn || 0) * TICK) + "s";
  }
  const rb = document.getElementById("respawn-b");
  if (rb) {
    rb.hidden = f.b.alive;
    if (!f.b.alive) rb.textContent = "respawn " + Math.ceil((f.b.respawn || 0) * TICK) + "s";
  }
  mobaBuildPanel("builds-a", moba.buildsA);
  mobaBuildPanel("builds-b", moba.buildsB);
}

function mobaBuildPanel(id, items) {
  const el = document.getElementById(id);
  if (!el) return;
  const key = (items || []).join("+");
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.innerHTML = "";
  for (const item of items || []) {
    const img = document.createElement("img");
    img.src = mobaIcon(item);
    img.alt = MOBA_ITEM_NAME[item] || item;
    img.title = MOBA_ITEM_NAME[item] || item;
    el.appendChild(img);
  }
  for (let i = (items || []).length; i < 6; i += 1) {
    const s = document.createElement("span");
    s.className = "slot-empty";
    el.appendChild(s);
  }
}

// Cosmetic tracers. Each victim with an HP drop pulls one bolt from
// the nearest in-range foe. Melee wounds show a slash spark instead.
function mobaSpawnBolts(p, f) {
  const victims = [];
  if (f.a.hp < p.a.hp) victims.push({ side: "A", x: f.a.x, y: f.a.y });
  if (f.b.hp < p.b.hp) victims.push({ side: "B", x: f.b.x, y: f.b.y });
  const prevMin = new Map();
  for (const mn of p.minions || []) prevMin.set(mn.id, mn);
  for (const mn of f.minions || []) {
    const was = prevMin.get(mn.id);
    if (was && mn.hp < was.hp) victims.push({ side: mn.side, x: mn.x, y: mn.y });
  }
  if (f.structs && moba.prevStructsForBolts) {
    for (let i = 0; i < f.structs.length; i += 1) {
      if (f.structs[i] < moba.prevStructsForBolts[i]) {
        const id = moba.order[i];
        const pos = mobaStructPos(id);
        victims.push({ side: mobaSideOf(id), x: pos.x, y: pos.y });
      }
    }
  }
  if (f.structs) moba.prevStructsForBolts = f.structs.slice();
  else if (!moba.prevStructsForBolts && moba.structs) moba.prevStructsForBolts = moba.structs.slice();
  for (const v of victims.slice(0, 12)) {
    const atk = mobaPickAttacker(v, f);
    if (!atk) {
      sparks.push({ x: v.x, y: v.y, age: 0, text: "hit", color: "#ffffff" });
      continue;
    }
    if (atk.kind === "slash") {
      sparks.push({ x: v.x, y: v.y, age: 0, text: "x", color: atk.color });
      continue;
    }
    moba.bolts.push({ x: atk.x, y: atk.y, px: atk.x, py: atk.y, tx: v.x, ty: v.y, side: atk.side, kind: atk.kind });
    moba.tracers.push({ x1: atk.x, y1: atk.y, x2: v.x, y2: v.y, side: atk.side, age: 0 });
    sparks.push({ x: atk.x, y: atk.y, age: 0, text: "", color: atk.color });
    if (moba.bolts.length > 60) moba.bolts.splice(0, moba.bolts.length - 60);
    if (moba.tracers.length > 60) moba.tracers.splice(0, moba.tracers.length - 60);
  }
}

function mobaPickAttacker(v, f) {
  const foe = v.side === "A" ? "B" : "A";
  const color = MOBA_COLOR[foe];
  const cands = [];
  const foeRobot = foe === "A" ? f.a : f.b;
  if (foeRobot.alive) {
    const d = Math.hypot(foeRobot.x - v.x, foeRobot.y - v.y);
    if (d <= MOBA_ROBOT_RANGE + 0.9) cands.push({ d, x: foeRobot.x, y: foeRobot.y, kind: "robot" });
  }
  for (const mn of f.minions || []) {
    if (mn.side !== foe) continue;
    const d = Math.hypot(mn.x - v.x, mn.y - v.y);
    if (mn.kind === "caster" && d <= MOBA_CASTER_RANGE + 0.9) cands.push({ d, x: mn.x, y: mn.y, kind: "caster" });
    else if (mn.kind === "melee" && d <= MOBA_MELEE_RANGE + 0.9) cands.push({ d: d - 0.01, x: mn.x, y: mn.y, kind: "slash" });
  }
  if (moba.structs) {
    for (let i = 0; i < moba.order.length; i += 1) {
      const id = moba.order[i];
      if (mobaSideOf(id) !== foe || moba.structs[i] <= 0) continue;
      const kind = mobaKindOf(id);
      if (kind !== "tower" && kind !== "nexus_turret") continue;
      const pos = mobaStructPos(id);
      const d = Math.hypot(pos.x - v.x, pos.y - v.y);
      if (d <= MOBA_TOWER_RANGE + 0.9) cands.push({ d, x: pos.x, y: pos.y, kind: "tower" });
    }
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => a.d - b.d);
  return { x: cands[0].x, y: cands[0].y, kind: cands[0].kind, side: foe, color };
}

function mobaFly(dt) {
  if (moba.beamLeft > 0) moba.beamLeft = Math.max(0, moba.beamLeft - dt);
  const keep = [];
  for (const b of moba.bolts) {
    b.px = b.x;
    b.py = b.y;
    const dx = b.tx - b.x;
    const dy = b.ty - b.y;
    const d = Math.hypot(dx, dy);
    const step = MOBA_BOLT_SPEED * dt;
    if (d <= step + 0.05) {
      sparks.push({ x: b.tx, y: b.ty, age: 0, text: "", color: MOBA_COLOR[b.side] });
      continue;
    }
    b.x += (dx / d) * step;
    b.y += (dy / d) * step;
    keep.push(b);
  }
  moba.bolts = keep;
}

function mobaGeom() {
  const s = Math.min(canvas.width / MW, canvas.height / MH);
  return { s, ox: (canvas.width - MW * s) / 2, oy: (canvas.height - MH * s) / 2 };
}

function drawMoba(t) {
  const f = moba.curr;
  const p = moba.prev || moba.curr;
  const { s, ox, oy } = mobaGeom();
  const glide = (a, b) => a + (b - a) * t;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#070b18";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Backdrop ring first, only when fully loaded. Grid fills the gaps.
  if (mobaRing.complete && mobaRing.naturalWidth > 0) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.drawImage(mobaRing, ox, oy, MW * s, MH * s);
    ctx.restore();
  }
  ctx.strokeStyle = "#131a36";
  ctx.lineWidth = 1;
  for (let x = 1; x < MW; x += 1) {
    ctx.beginPath();
    ctx.moveTo(ox + x * s, oy);
    ctx.lineTo(ox + x * s, oy + MH * s);
    ctx.stroke();
  }
  for (let y = 1; y < MH; y += 1) {
    ctx.beginPath();
    ctx.moveTo(ox, oy + y * s);
    ctx.lineTo(ox + MW * s, oy + y * s);
    ctx.stroke();
  }
  // Lane band and center line.
  ctx.fillStyle = "#37e0ff0d";
  ctx.fillRect(ox + 2 * s, oy + (MOBA_LANE_Y - 2.5) * s, 44 * s, 5 * s);
  ctx.strokeStyle = "#37e0ff33";
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(ox + 2 * s, oy + MOBA_LANE_Y * s);
  ctx.lineTo(ox + 46 * s, oy + MOBA_LANE_Y * s);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "#05070f";
  ctx.strokeRect(ox, oy, MW * s, MH * s);
  ctx.fillStyle = "#1a2450";
  for (const c of MOBA_COVERS) {
    ctx.fillRect(ox + c.x1 * s, oy + c.y1 * s, (c.x2 - c.x1) * s, (c.y2 - c.y1) * s);
    ctx.strokeStyle = "#05070f";
    ctx.strokeRect(ox + c.x1 * s, oy + c.y1 * s, (c.x2 - c.x1) * s, (c.y2 - c.y1) * s);
  }
  const hpById = mobaHpById();
  for (const id of moba.order) mobaStructure(id, hpById, s, ox, oy);
  // Minions glide by id. New spawns start at their live spot.
  const prevMin = new Map();
  for (const mn of p.minions || []) prevMin.set(mn.id, mn);
  for (const mn of f.minions || []) {
    const was = prevMin.get(mn.id) || mn;
    mobaMinion({ x: glide(was.x, mn.x), y: glide(was.y, mn.y), side: mn.side, kind: mn.kind, hp: mn.hp }, s, ox, oy);
  }
  const ax = f.a.alive ? glide(p.a.x, f.a.x) : f.a.x;
  const ay = f.a.alive ? glide(p.a.y, f.a.y) : f.a.y;
  const bx = f.b.alive ? glide(p.b.x, f.b.x) : f.b.x;
  const by = f.b.alive ? glide(p.b.y, f.b.y) : f.b.y;
  mobaUnit({ x: ax, y: ay, alive: f.a.alive, shield: (f.a.shield || 0) > 0 }, MOBA_COLOR.A, moba.faceA, s, ox, oy);
  mobaUnit({ x: bx, y: by, alive: f.b.alive, shield: (f.b.shield || 0) > 0 }, MOBA_COLOR.B, moba.faceB, s, ox, oy);
  mobaTracers(s, ox, oy);
  mobaBolts(s, ox, oy);
  drawMobaSparks(s, ox, oy);
  mobaBeam(s, ox, oy);
}

function mobaStructure(id, hpById, s, ox, oy) {
  const pos = mobaStructPos(id);
  const side = mobaSideOf(id);
  const color = MOBA_COLOR[side];
  const hp = hpById[id] || 0;
  const max = MOBA_MAXHP[mobaKey(id)] || 1;
  const r = (MOBA_RADIUS[mobaKey(id)] || 0.6) * s;
  const px = ox + pos.x * s;
  const py = oy + pos.y * s;
  const kind = mobaKindOf(id);
  if (hp <= 0) {
    ctx.strokeStyle = "#3a4568";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px - r, py - r);
    ctx.lineTo(px + r, py + r);
    ctx.moveTo(px + r, py - r);
    ctx.lineTo(px - r, py + r);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = "#05070f";
  ctx.beginPath();
  ctx.ellipse(px, py + r * 0.9, r, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#141b33";
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (kind === "nexus") {
    ctx.moveTo(px, py - r * 1.3);
    ctx.lineTo(px + r, py);
    ctx.lineTo(px, py + r * 1.3);
    ctx.lineTo(px - r, py);
    ctx.closePath();
  } else if (kind === "inhibitor") {
    for (let i = 0; i < 6; i += 1) {
      const a = (Math.PI / 3) * i;
      const vx = px + Math.cos(a) * r;
      const vy = py + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    }
    ctx.closePath();
  } else {
    const tall = kind === "tower" ? 1.9 : 1.5;
    ctx.rect(px - r * 0.7, py - r * tall, r * 1.4, r * (tall + 1));
  }
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px, py - (kind === "tower" || kind === "nexus_turret" ? r : 0), Math.max(2, r * 0.28), 0, Math.PI * 2);
  ctx.fill();
  if (!mobaVulnerable(id, hpById)) {
    ctx.strokeStyle = "#ffffff88";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(px, py, r + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // HP bar with team color.
  const w = Math.max(28, r * 2.6);
  ctx.fillStyle = "#05070f";
  ctx.fillRect(px - w / 2 - 1, py - r * 2.1 - 7, w + 2, 6);
  ctx.fillStyle = "#22333c";
  ctx.fillRect(px - w / 2, py - r * 2.1 - 6, w, 4);
  ctx.fillStyle = color;
  ctx.fillRect(px - w / 2, py - r * 2.1 - 6, w * Math.max(0, hp / max), 4);
}

function mobaMinion(mn, s, ox, oy) {
  const color = MOBA_COLOR[mn.side];
  const px = ox + mn.x * s;
  const py = oy + mn.y * s;
  const r = 0.36 * s;
  const max = mn.kind === "melee" ? 200 : 100;
  ctx.fillStyle = "#05070f";
  ctx.beginPath();
  ctx.ellipse(px, py + r * 0.9, r, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.strokeStyle = "#05070f";
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (mn.kind === "melee") {
    ctx.moveTo(px, py - r);
    ctx.lineTo(px + r, py);
    ctx.lineTo(px, py + r);
    ctx.lineTo(px - r, py);
    ctx.closePath();
  } else {
    ctx.arc(px, py, r * 0.85, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = mn.kind === "melee" ? "#05070f" : "#ffffff";
  ctx.beginPath();
  ctx.arc(px, py, Math.max(1.5, r * 0.3), 0, Math.PI * 2);
  ctx.fill();
  const w = r * 2.4;
  ctx.fillStyle = "#05070f";
  ctx.fillRect(px - w / 2, py - r - 6, w, 3);
  ctx.fillStyle = color;
  ctx.fillRect(px - w / 2, py - r - 6, w * Math.max(0, Math.min(1, mn.hp / max)), 3);
}

function mobaUnit(me, color, face, s, ox, oy) {
  const px = ox + me.x * s;
  const py = oy + me.y * s;
  const r = 0.35 * s;
  if (!me.alive) {
    ctx.strokeStyle = "#3a4568";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px - r, py - r);
    ctx.lineTo(px + r, py + r);
    ctx.moveTo(px + r, py - r);
    ctx.lineTo(px - r, py + r);
    ctx.stroke();
    return;
  }
  const ang = Math.atan2(face.y || 0, face.x || 1);
  ctx.fillStyle = "#05070f";
  ctx.beginPath();
  ctx.ellipse(px, py + r + 3, r + 3, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(ang);
  ctx.fillStyle = "#141b33";
  ctx.strokeStyle = "#05070f";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-r, -r * 0.8, r * 2, r * 1.6, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-r, -r * 0.8, r * 2, r * 0.55, 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(r * 0.3, -r * 0.2, r * 0.55, r * 0.4);
  ctx.restore();
  if (me.shield) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, r + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(px, py, r + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// Fading shot lines. Each bolt leaves one, so volleys read
// even when the bolt itself already landed.
function mobaTracers(s, ox, oy) {
  const keep = [];
  for (const tr of moba.tracers) {
    tr.age += 1;
    if (tr.age > 14) continue;
    keep.push(tr);
    const color = MOBA_COLOR[tr.side];
    ctx.save();
    ctx.globalAlpha = 0.75 * (1 - tr.age / 14);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox + tr.x1 * s, oy + tr.y1 * s);
    ctx.lineTo(ox + tr.x2 * s, oy + tr.y2 * s);
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox + tr.x1 * s, oy + tr.y1 * s);
    ctx.lineTo(ox + tr.x2 * s, oy + tr.y2 * s);
    ctx.stroke();
    ctx.restore();
  }
  moba.tracers = keep;
}

// Bright team-colored bolts with trails. Towers fire big bolts,
// robots medium, casters small.
function mobaBolts(s, ox, oy) {
  const size = { tower: 6, robot: 4.2, caster: 3.2 };
  ctx.save();
  for (const b of moba.bolts) {
    const color = MOBA_COLOR[b.side];
    const r = size[b.kind] || 3;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = r;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ox + b.px * s, oy + b.py * s);
    ctx.lineTo(ox + b.x * s, oy + b.y * s);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(ox + b.x * s, oy + b.y * s, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ox + b.x * s, oy + b.y * s, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawMobaSparks(s, ox, oy) {
  const keep = [];
  for (const p of sparks) {
    p.age += 1;
    if (p.age > 24) continue;
    keep.push(p);
    const k = 1 - p.age / 24;
    ctx.globalAlpha = k;
    if (p.text) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "600 13px 'Chakra Petch', sans-serif";
      ctx.fillText(p.text, ox + p.x * s + 8, oy + p.y * s - p.age);
    }
    ctx.fillStyle = p.color;
    const r = 5 * k + 1;
    ctx.fillRect(ox + p.x * s - r / 2, oy + p.y * s - r / 2 - p.age / 2, r, r);
    ctx.globalAlpha = 1;
  }
  sparks = keep;
}

function mobaBeam(s, ox, oy) {
  let alpha = 0;
  if (moba.beamLeft > 0) alpha = Math.min(1, moba.beamLeft / 2.5);
  else if (moba.nexusDead && over) alpha = 0.45;
  if (!moba.beam || alpha <= 0) return;
  const px = ox + moba.beam.x * s;
  const py = oy + moba.beam.y * s;
  ctx.save();
  ctx.globalAlpha = alpha;
  const grad = ctx.createLinearGradient(px, 0, px, canvas.height);
  grad.addColorStop(0, "#ffffff00");
  grad.addColorStop(0.5, "#ffffffff");
  grad.addColorStop(1, "#ffffff00");
  ctx.fillStyle = grad;
  ctx.fillRect(px - 14, 0, 28, canvas.height);
  ctx.strokeStyle = MOBA_COLOR[moba.beam.side];
  ctx.lineWidth = 3;
  const rr = (2.5 - moba.beamLeft) * 40 + 10;
  ctx.beginPath();
  ctx.arc(px, py, Math.max(10, rr), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  if (moba.beamLeft > 1.7) {
    ctx.save();
    ctx.globalAlpha = (moba.beamLeft - 1.7) * 0.45;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
}

function syncMoba() {
  const f = moba.curr;
  pillTick.textContent = "tick " + f.t;
  hpA.style.width = Math.max(0, Math.min(100, (f.a.hp / moba.maxA) * 100)) + "%";
  hpB.style.width = Math.max(0, Math.min(100, (f.b.hp / moba.maxB) * 100)) + "%";
  enA.style.width = Math.max(0, Math.min(100, f.a.en)) + "%";
  enB.style.width = Math.max(0, Math.min(100, f.b.en)) + "%";
  const clock = document.getElementById("arena-clock");
  if (clock) clock.textContent = mobaClock(f.t);
  const compact = document.getElementById("diag-compact");
  if (compact) compact.textContent = "moba replay · " + moba.frames.length + " frames";
}

function finishMoba() {
  const m = moba.meta || {};
  winner = m.winner || null;
  const name = winner === "A" ? "Cyan" : winner === "B" ? "Crimson" : null;
  const fell = moba.events.some((e) => e.type === "structure" && mobaKey(e.id) === "nexus");
  endTitle.textContent = winner === "DRAW" || !name ? "Draw" : name + " wins";
  const ticks = m.ticks ?? tick;
  const how = fell ? "Nexus destroyed" : "time cap tiebreak";
  endStats.textContent = ticks + " ticks · " + mobaClock(ticks) + " · " + how;
  const econ = document.getElementById("end-econ");
  if (econ) econ.textContent = m.econ ? String(m.econ) : "";
  pillWinner.textContent = "winner: " + (winner || "DRAW");
  pillState.textContent = "done";
  mobaRecap();
  endcard.hidden = false;
  drawMoba(1);
  note("MOBA replay ends. " + endTitle.textContent + ". " + how + ".");
  moba.frames = [];
}

// Post-match build recap. Final items, gold earned and spent,
// and robot kills, all read from frames and replay events.
// Spent sums final item totals plus Repair Cells from buy
// events. Earned adds final gold and subtracts start gold.
function mobaRecap() {
  const el = document.getElementById("end-builds");
  if (!el || !moba || !moba.curr) return;
  const gold = { A: moba.curr.a.gold || 0, B: moba.curr.b.gold || 0 };
  const builds = { A: moba.buildsA || [], B: moba.buildsB || [] };
  const kills = { A: 0, B: 0 };
  const repairs = { A: 0, B: 0 };
  for (const e of moba.events) {
    if (e.type === "kill" && (e.side === "A" || e.side === "B")) kills[e.side === "A" ? "B" : "A"] += 1;
    if (e.type === "buy" && e.item === "repair_cell" && (e.side === "A" || e.side === "B")) repairs[e.side] += 1;
  }
  el.innerHTML = "";
  for (const side of ["A", "B"]) {
    let spent = (MOBA_ITEM_TOTAL.repair_cell || 0) * repairs[side];
    for (const item of builds[side]) spent += MOBA_ITEM_TOTAL[item] || 0;
    const earned = Math.max(0, gold[side] + spent - MOBA_START_GOLD);
    const row = document.createElement("div");
    row.className = "recap-side";
    const head = document.createElement("p");
    head.className = "recap-head";
    const who = document.createElement("span");
    who.className = "name " + (side === "A" ? "tag-a" : "tag-b");
    who.textContent = side === "A" ? "CYAN" : "CRIMSON";
    head.appendChild(who);
    head.appendChild(document.createTextNode(
      " · " + kills[side] + (kills[side] === 1 ? " kill" : " kills") +
      " · earned " + earned + "g · spent " + spent + "g"
    ));
    row.appendChild(head);
    const icons = document.createElement("div");
    icons.className = "builds recap-icons";
    icons.setAttribute("aria-label", (side === "A" ? "Cyan" : "Crimson") + " final build");
    for (const item of builds[side]) {
      const img = document.createElement("img");
      img.src = mobaIcon(item);
      img.alt = MOBA_ITEM_NAME[item] || item;
      img.title = MOBA_ITEM_NAME[item] || item;
      icons.appendChild(img);
    }
    if (builds[side].length === 0) {
      const none = document.createElement("span");
      none.className = "recap-none";
      none.textContent = "no items";
      icons.appendChild(none);
    }
    row.appendChild(icons);
    el.appendChild(row);
  }
  el.hidden = false;
}
