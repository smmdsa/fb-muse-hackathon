// Arena E2E. A real browser loads the arena, queues a live fight,
// and plays one golden best-of-3 series to the endcard. Run it
// with `pnpm e2e` from the repo root. It starts its own server.

import { test, expect } from "playwright/test";
import { startE2EServer } from "./serve.mjs";
import { seedE2E, GOLDEN_CHECKSUM, GOLDEN_MATCH_ID } from "./fixtures.mjs";

test.describe.configure({ mode: "serial" });

let base = "";
let users = null;
let stop = null;

test.beforeAll(async () => {
  const srv = await startE2EServer();
  base = srv.url;
  users = seedE2E(srv.store);
  stop = srv.close;
});

test.afterAll(async () => {
  if (stop) await stop();
});

// The patch counts real canvas draws. Shots are the only arc fills
// with radius 4 or 7. Pickups are the only 10x10 fills in their
// colors. Robots use roundRect and other rect sizes, so the counts
// stay clean. It must load before the game script runs.
async function watchCanvas(context) {
  await context.addInitScript(() => {
    window.__e2e = { shots: { cyan: 0, red: 0, powered: 0 }, pickups: { green: 0, blue: 0, red: 0 } };
    const proto = CanvasRenderingContext2D.prototype;
    const rawArc = proto.arc;
    let lastR = -1;
    proto.arc = function (x, y, r, ...rest) {
      lastR = r;
      return rawArc.call(this, x, y, r, ...rest);
    };
    const rawFill = proto.fill;
    proto.fill = function (...args) {
      const paint = String(this.fillStyle || "").toLowerCase();
      if (lastR === 4 || lastR === 7) {
        if (paint === "#37e0ff") window.__e2e.shots.cyan += 1;
        else if (paint === "#ff5d7a") window.__e2e.shots.red += 1;
        if (lastR === 7 && (paint === "#37e0ff" || paint === "#ff5d7a")) window.__e2e.shots.powered += 1;
      }
      lastR = -1;
      return rawFill.apply(this, args);
    };
    const rawRect = proto.fillRect;
    proto.fillRect = function (x, y, w, h) {
      const paint = String(this.fillStyle || "").toLowerCase();
      if (w === 10 && h === 10) {
        if (paint === "#3dff7a") window.__e2e.pickups.green += 1;
        else if (paint === "#37e0ff") window.__e2e.pickups.blue += 1;
        else if (paint === "#ff5d5d") window.__e2e.pickups.red += 1;
      }
      return rawRect.call(this, x, y, w, h);
    };
  });
}

async function loginAs(context, user) {
  await context.addInitScript(({ token, handle }) => {
    localStorage.setItem("aw_token", token);
    localStorage.setItem("aw_handle", handle);
  }, { token: user.token, handle: user.handle });
}

test("arena lobby loads and a live queue settles into battle", async ({ browser, request }) => {
  const context = await browser.newContext({ reducedMotion: "no-preference" });
  try {
    await loginAs(context, users.alice);
    const page = await context.newPage();
    await page.goto(`${base}/arena.html`);
    await expect(page.locator("#queue-normal")).toBeVisible();
    await expect(page.locator("#qm-energy")).toContainText("energy 10/10");
    // Bob waits first, so Alice pairs at once instead of 30 seconds.
    const wait = await request.post(`${base}/v1/matchmaking/request`, {
      headers: { authorization: `Bearer ${users.bob.token}` },
      data: { versionId: users.bob.versionId, mode: "casual" },
    });
    expect(wait.status()).toBe(201);
    await page.click("#queue-normal");
    await expect(page.locator("#battle-view")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#arena-series")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#series-round")).toContainText("BEST OF 3", { timeout: 20_000 });
    const size = await page.locator("#arena").evaluate((c) => ({ w: c.width, h: c.height }));
    expect(size).toEqual({ w: 960, h: 640 });
    await expect(page.locator("#feed")).toContainText("Round 1 starts", { timeout: 20_000 });
    await expect(page.locator("#qm-energy")).toContainText("energy 9/10", { timeout: 20_000 });
  } finally {
    await context.close();
  }
});

test("golden series plays shots, pickups, energy, skill, and a full BO3", async ({ browser, request }) => {
  // The replay comes from the server that settled the golden match.
  const res = await request.get(`${base}/v1/matches/${GOLDEN_MATCH_ID}/replay`, {
    headers: { authorization: `Bearer ${users.alice.token}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.identical).toBe(true);
  const replay = body.replay;
  expect(replay.version).toBe(3);
  expect(replay.mode).toBe("arena");
  expect(replay.checksum).toBe(GOLDEN_CHECKSUM);
  expect(replay.rounds.length).toBe(2);
  expect(replay.score).toEqual({ A: 0, B: 2 });

  const frames = replay.rounds.flatMap((r) => r.frames);
  const events = replay.rounds.flatMap((r) => r.events || []);
  // Shots spawn 0.6u ahead, fly 6u max, and the owner moves at most
  // 1.7u during that flight. Frames sample live spots, so 8.3u bounds
  // every shot. The exact 6u pin lives in the battle-core tests.
  let shots = 0;
  let far = 0;
  let top = 0;
  for (const f of frames) {
    for (const s of f.shots || []) {
      shots += 1;
      const dx = s.x - (s.o === "A" ? f.ax : f.bx);
      const dy = s.y - (s.o === "A" ? f.ay : f.by);
      const d = Math.hypot(dx, dy);
      top = Math.max(top, d);
      if (d > 3) far += 1;
      expect(d).toBeLessThanOrEqual(8.3);
    }
  }
  expect(shots).toBeGreaterThan(20);
  expect(far).toBeGreaterThan(0);
  const kinds = new Set(events.filter((e) => e.type === "pickup").map((e) => e.kind));
  expect([...kinds].sort()).toEqual(["blue", "green", "red"]);
  const skills = events.filter((e) => e.type === "skill");
  expect(skills.length).toBeGreaterThan(0);
  expect(new Set(skills.map((e) => e.side))).toEqual(new Set(["A", "B"]));
  expect(frames.some((f) => (f.shots || []).some((s) => s.p))).toBe(true);
  // Energy falls on skill spend and climbs back by regen each tick.
  const mins = [Math.min(...frames.map((f) => f.aen)), Math.min(...frames.map((f) => f.ben))];
  expect(Math.min(...mins)).toBeLessThan(90);
  let rises = 0;
  for (let i = 1; i < frames.length; i += 1) {
    if (frames[i].aen > frames[i - 1].aen + 0.01 || frames[i].ben > frames[i - 1].ben + 0.01) rises += 1;
  }
  expect(rises).toBeGreaterThan(10);

  const context = await browser.newContext({ reducedMotion: "no-preference" });
  try {
    await loginAs(context, users.alice);
    await watchCanvas(context);
    const page = await context.newPage();
    await page.goto(`${base}/arena.html?replay=${GOLDEN_MATCH_ID}`);
    await expect(page.locator("#battle-view")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#arena-series")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#series-round")).toContainText("ROUND 1/2", { timeout: 20_000 });
    await page.click("#speed-btn");
    await page.click("#speed-btn");
    await expect(page.locator("#speed-btn")).toContainText("Speed 4x");
    // The feed holds 30 lines in a closed panel, so the check
    // gathers raw text while it plays instead of visible lines.
    const seen = [];
    const widths = new Set();
    const start = Date.now();
    let done = false;
    while (Date.now() - start < 100_000) {
      seen.push((await page.locator("#feed").textContent()) ?? "");
      widths.add(await page.locator("#en-a").evaluate((el) => el.style.width));
      if (await page.locator("#endcard").isVisible()) {
        done = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    expect(done).toBe(true);
    const log = seen.join("\n");
    expect(log).toMatch(/takes green pickup/);
    expect(log).toMatch(/takes blue pickup/);
    expect(log).toMatch(/takes red pickup/);
    expect(log).toMatch(/fires a powered shot/);
    expect(log).toMatch(/Round 1 ends/);
    expect(log).toMatch(/Round 2 ends/);
    expect(widths.size).toBeGreaterThan(2);
    await expect(page.locator("#end-title")).toContainText("BOB wins the series");
    await expect(page.locator("#end-stats")).toContainText("R1");
    await expect(page.locator("#end-stats")).toContainText("R2");
    await expect(page.locator("#end-stats")).toContainText("checksum verified");
    await expect(page.locator("#series-round")).toContainText("FINAL");
    const hpA = await page.locator("#hp-a").evaluate((el) => parseFloat(el.style.width));
    expect(hpA).toBeLessThan(5);
    const draws = await page.evaluate(() => window.__e2e);
    expect(draws.shots.cyan).toBeGreaterThan(0);
    expect(draws.shots.red).toBeGreaterThan(0);
    expect(draws.shots.powered).toBeGreaterThan(0);
    expect(draws.pickups.green).toBeGreaterThan(0);
    expect(draws.pickups.blue).toBeGreaterThan(0);
    expect(draws.pickups.red).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});
