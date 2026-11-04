// Barracks layout end to end. The loading gate shows first, then
// the session state decides: login card when signed out, the
// Agent Forge with AutoBattle inside when signed in.
import { expect, test } from "playwright/test";
import { startE2EServer } from "./serve.mjs";
import { seedE2E } from "./fixtures.mjs";

async function loginAs(context, user) {
  await context.addInitScript(({ token, handle }) => {
    localStorage.setItem("aw_token", token);
    localStorage.setItem("aw_handle", handle);
  }, { token: user.token, handle: user.handle });
}

test("barracks shows loading until the session resolves", async ({ browser }) => {
  const srv = await startE2EServer();
  const users = seedE2E(srv.store);
  const ctx = await browser.newContext();
  await loginAs(ctx, users.alice);
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e).slice(0, 160)));
  try {
    await page.route("**/v1/me", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.goto(`${srv.url}/profile.html`);
    await expect(page.locator("#session-loading")).toBeVisible();
    await expect(page.locator("#login-card")).toBeHidden();
    await expect(page.locator("#hero-card")).toBeHidden();
    await expect(page.locator("#hero-card")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#session-loading")).toBeHidden();
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await srv.close();
  }
});

test("auto buttons toggle per running mode", async ({ browser, request }) => {
  const srv = await startE2EServer();
  const users = seedE2E(srv.store);
  const ctx = await browser.newContext();
  await loginAs(ctx, users.alice);
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e).slice(0, 160)));
  try {
    await page.goto(`${srv.url}/profile.html`);
    await expect(page.locator("#auto-opt")).toHaveText("Start auto-battle", { timeout: 15000 });
    await expect(page.locator("#auto-opt-ranked")).toHaveText("Start auto-battle");
    await expect(page.locator("#auto-recent")).toHaveCount(0);
    await expect(page.locator("#auto-pause")).toHaveCount(0);
    const opt = await request.post(`${srv.url}/v1/autobattle/opt-in`, {
      headers: { authorization: `Bearer ${users.alice.token}` },
      data: { mode: "ranked" },
    });
    expect(opt.status()).toBe(200);
    await page.reload();
    await expect(page.locator("#auto-opt-ranked")).toHaveText("Stop auto-battle", { timeout: 15000 });
    await expect(page.locator("#auto-opt")).toHaveText("Start auto-battle");
    await page.click("#auto-opt-ranked");
    await expect(page.locator("#auto-opt-ranked")).toHaveText("Start auto-battle", { timeout: 15000 });
    await expect(page.locator("#auto-opt")).toHaveText("Start auto-battle");
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await srv.close();
  }
});

test("stop clears the queue line and frees the slot", async ({ browser, request }) => {
  const srv = await startE2EServer();
  const users = seedE2E(srv.store);
  const ctx = await browser.newContext();
  await loginAs(ctx, users.alice);
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e).slice(0, 160)));
  try {
    const opt = await request.post(`${srv.url}/v1/autobattle/opt-in`, {
      headers: { authorization: `Bearer ${users.alice.token}` },
      data: { mode: "ranked" },
    });
    expect(opt.status()).toBe(200);
    const q = await request.post(`${srv.url}/v1/matchmaking/request`, {
      headers: { authorization: `Bearer ${users.alice.token}` },
      data: { versionId: users.alice.versionId, mode: "ranked" },
    });
    expect(q.status()).toBe(201);
    await page.goto(`${srv.url}/profile.html`);
    await expect(page.locator("#auto-live")).toContainText("IN QUEUE - RANKED", { timeout: 15000 });
    await expect(page.locator("#auto-opt-ranked")).toHaveText("Stop auto-battle");
    await page.click("#auto-opt-ranked");
    await expect(page.locator("#auto-opt-ranked")).toHaveText("Start auto-battle", { timeout: 15000 });
    await expect(page.locator("#auto-live")).toBeHidden();
    const digest = await request.get(`${srv.url}/v1/autobattle/digest`, {
      headers: { authorization: `Bearer ${users.alice.token}` },
    });
    expect(digest.ok()).toBe(true);
    expect((await digest.json()).queue).toBe(null);
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await srv.close();
  }
});

test("history splits normal and ranked tabs", async ({ browser, request }) => {
  const srv = await startE2EServer();
  const users = seedE2E(srv.store);
  const ctx = await browser.newContext();
  await loginAs(ctx, users.alice);
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e).slice(0, 160)));
  try {
    const ranked = await request.post(`${srv.url}/v1/matches/ranked`, {
      headers: { authorization: `Bearer ${users.alice.token}` },
      data: { aVersionId: users.alice.versionId, bVersionId: users.bob.versionId, seed: "e2e-tab-1", key: "e2e-tab-1" },
    });
    expect(ranked.status()).toBe(201);
    await page.goto(`${srv.url}/profile.html`);
    await expect(page.locator("#hist-normal")).toContainText("Normal (1)", { timeout: 15000 });
    await expect(page.locator("#hist-ranked")).toContainText("Ranked (1)");
    await expect(page.locator("#hist > p")).toHaveCount(1);
    await page.click("#hist-ranked");
    await expect(page.locator("#hist > p")).toHaveCount(1);
    await expect(page.locator("#hist")).toContainText("AP ");
    await page.click("#hist-normal");
    await expect(page.locator("#hist > p")).toHaveCount(1);
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await srv.close();
  }
});

test("signed-in barracks opens the forge with autobattle inside", async ({ browser }) => {
  const srv = await startE2EServer();
  const users = seedE2E(srv.store);
  const ctx = await browser.newContext();
  await loginAs(ctx, users.alice);
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e).slice(0, 160)));
  try {
    await page.goto(`${srv.url}/profile.html`);
    await expect(page.locator("#hero-card")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#session-loading")).toBeHidden();
    await expect(page.locator("#login-card")).toBeHidden();
    await expect(page.locator("#hero-card h2")).toContainText("AGENT FORGE");
    await expect(page.locator("#hero-card #auto-card")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#auto-status")).not.toContainText("energy");
    await expect(page.locator("#hero-energy")).toHaveCount(0);
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await srv.close();
  }
});
