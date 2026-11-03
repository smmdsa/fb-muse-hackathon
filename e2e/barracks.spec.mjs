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
