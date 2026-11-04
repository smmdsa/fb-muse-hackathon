// Auto battle loop end to end. The barracks ranked button opts
// in and deeplinks to the arena, which queues by itself, shows
// the mode banner, cools down 10s after the endcard, and halts
// when the lease pauses.
import { expect, test } from "playwright/test";
import { startE2EServer } from "./serve.mjs";
import { seedE2E } from "./fixtures.mjs";

async function loginAs(context, user) {
  await context.addInitScript(({ token, handle }) => {
    localStorage.setItem("aw_token", token);
    localStorage.setItem("aw_handle", handle);
  }, { token: user.token, handle: user.handle });
}

test("barracks ranked button starts ranked auto queue", async ({ browser }) => {
  const srv = await startE2EServer();
  const users = seedE2E(srv.store);
  const ctx = await browser.newContext();
  await loginAs(ctx, users.alice);
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e).slice(0, 160)));
  try {
    await page.goto(`${srv.url}/profile.html`);
    await expect(page.locator("#auto-opt-ranked")).toBeVisible({ timeout: 15000 });
    await page.click("#auto-opt-ranked");
    await page.waitForURL("**/arena.html?auto=ranked", { timeout: 15000 });
    // The loop skips the lobby: battle view plus the queue panel only.
    await expect(page.locator("#lobby-view")).toBeHidden({ timeout: 15000 });
    await expect(page.locator("#battle-view")).toBeVisible();
    await expect(page.locator("#auto-banner")).toContainText("RANKED MODE");
    await expect(page.locator("#auto-queue")).toBeVisible();
    await expect(page.locator("#auto-queue")).toContainText("IN QUEUE");
    await expect(page.locator("#auto-queue-text")).toContainText("Waiting for opponent");
    await expect(page.locator("#auto-queue-text")).toContainText(/\d\dmin \d\dsec/);
    expect(await page.evaluate(() => fmtWait(125))).toBe("02min 05sec");
    await expect(page.locator("#qm-status")).toContainText("AUTO BATTLE ON", { timeout: 15000 });
    await page.locator("#qm-cancel").evaluate((el) => el.click());
    await expect(page.locator("#qm-status")).toContainText("slot is freed");
    await expect(page.locator("#auto-banner")).toBeHidden();
    await expect(page.locator("#lobby-view")).toBeVisible();
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await srv.close();
  }
});

test("start swaps the mode section to a starting line", async ({ browser }) => {
  const srv = await startE2EServer();
  const users = seedE2E(srv.store);
  const ctx = await browser.newContext();
  await loginAs(ctx, users.alice);
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e).slice(0, 160)));
  try {
    await page.route("**/v1/autobattle/opt-in", async (route) => {
      await new Promise((r) => setTimeout(r, 900));
      await route.continue();
    });
    await page.goto(`${srv.url}/profile.html`);
    await expect(page.locator("#auto-opt")).toBeVisible({ timeout: 15000 });
    await page.click("#auto-opt");
    await expect(page.locator("#auto-mode-casual .auto-starting")).toContainText("Starting auto battle", { timeout: 5000 });
    await page.waitForURL("**/arena.html?auto=casual", { timeout: 15000 });
    await expect(page.locator("#auto-queue")).toBeVisible({ timeout: 15000 });
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await srv.close();
  }
});

test("endcard starts the 10s cooldown and pause halts requeue", async ({ browser, request }) => {
  const srv = await startE2EServer();
  const users = seedE2E(srv.store);
  const ctx = await browser.newContext();
  await loginAs(ctx, users.alice);
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e).slice(0, 160)));
  try {
    await page.goto(`${srv.url}/arena.html?auto=casual`);
    await expect(page.locator("#qm-status")).toContainText("AUTO BATTLE ON", { timeout: 15000 });
    await expect(page.locator("#auto-banner")).toContainText("NORMAL MODE");
    await page.locator("#endcard").evaluate((el) => { el.hidden = false; });
    await expect(page.locator("#auto-banner")).toContainText("NEXT QUEUE IN 10");
    await expect(page.locator("#qm-status")).toContainText("Result stands. Next queue in");
    const pause = await request.post(`${srv.url}/v1/autobattle/pause`, {
      headers: { authorization: `Bearer ${users.alice.token}` },
    });
    expect(pause.status()).toBe(200);
    // Stop cancels the open ticket too, so the next poll halts the loop
    // with the freed slot instead of waiting out the cooldown.
    await expect(page.locator("#qm-status")).toContainText("Ticket canceled. The slot is freed.", { timeout: 20000 });
    await expect(page.locator("#auto-banner")).toBeHidden();
    await expect(page.locator("#lobby-view")).toBeVisible();
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await srv.close();
  }
});
