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

let agents = null;
let shots = [];
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

function spawn(side) {
  return {
    side,
    x: side === "A" ? 2 : W - 2,
    y: H / 2,
    hp: MAX_HP,
    en: MAX_EN,
    ax: side === "A" ? 1 : -1,
    ay: 0,
    alive: true,
    shieldUntil: 0,
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

function policy(me, foe, dna) {
  const dx = foe.x - me.x;
  const dy = foe.y - me.y;
  const dist = Math.hypot(dx, dy) || 1;
  const want = 3 + (dna.dist / 100) * 8;
  let mx;
  let my;
  if (dist > want + 1) { mx = dx / dist; my = dy / dist; }
  else if (dist < want - 1) { mx = -dx / dist; my = -dy / dist; }
  else {
    mx = -dy / dist;
    my = dx / dist;
    if (((tick >> 6) % 2) === 1) { mx = -mx; my = -my; }
  }
  const fire = dist < 12 && dna.agg > 25;
  const dash = dna.agg > 65 && me.en > 50 && dist > 6 && dist < 10;
  return { mx, my, ax: dx / dist, ay: dy / dist, fire, dash };
}

const SHADOW = { agg: 35, dist: 65 };
const BREAKER = { agg: 80, dist: 20 };

function step() {
  if (over || paused) return;
  tick += 1;
  time += TICK;
  const A = agents.A;
  const B = agents.B;
  const pa = policy(A, B, SHADOW);
  const pb = policy(B, A, BREAKER);
  move(A, pa);
  move(B, pb);
  shoot(A, pa, "A");
  shoot(B, pb, "B");
  fly();
  if (!A.alive || !B.alive) {
    over = true;
    winner = A.alive ? "A" : B.alive ? "B" : "DRAW";
    note("Battle ends. Winner: " + winner);
    pillWinner.textContent = "winner: " + winner;
    pillState.textContent = "done";
  } else if (tick >= 2700) {
    over = true;
    winner = A.hp === B.hp ? "DRAW" : A.hp > B.hp ? "A" : "B";
    note("Time ends. Winner: " + winner);
    pillWinner.textContent = "winner: " + winner;
    pillState.textContent = "done";
  }
  draw();
  sync();
}

function move(me, p) {
  if (!me.alive) return;
  let sp = SPEED;
  if (p.dash && me.en >= DASH_COST) { sp *= 3.2; me.en -= DASH_COST; }
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
      t.hp -= SHOT_DMG;
      note(s.owner + " hits for " + SHOT_DMG);
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
  ctx.strokeStyle = "#223";
  ctx.strokeRect(W / 2 * sx - 2 * sx, H / 2 * sy - 2 * sy, 4 * sx, 4 * sy);
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

function reset() {
  agents = { A: spawn("A"), B: spawn("B") };
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
}

startBtn.addEventListener("click", () => {
  const seed = seedInput.value.trim() || "forge-001";
  pillSeed.textContent = "seed " + seed;
  reset();
  note("Battle starts: SHADOW.EXE vs BREAKER.01");
  pillState.textContent = "live";
  startBtn.disabled = true;
  restartBtn.disabled = false;
  pauseBtn.disabled = false;
  pauseBtn.textContent = "Pause";
  clearInterval(timer);
  timer = setInterval(step, 1000 / 30);
  draw();
  sync();
});

restartBtn.addEventListener("click", () => {
  reset();
  note("Battle restarts");
  pillState.textContent = "live";
  pauseBtn.textContent = "Pause";
  clearInterval(timer);
  timer = setInterval(step, 1000 / 30);
});

pauseBtn.addEventListener("click", () => {
  paused = !paused;
  pauseBtn.textContent = paused ? "Resume" : "Pause";
  pillState.textContent = paused ? "paused" : "live";
});
