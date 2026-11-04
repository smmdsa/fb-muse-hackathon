// Chip Lab gate end to end. Loading paints while the session
// resolves; a lost session shows the sign-in invite instead.
import { expect, test } from "playwright/test";
import { startE2EServer } from "./serve.mjs";
import { seedE2E } from "./fixtures.mjs";

async function loginAs(context, user) {
  await context.addInitScript(({ token, handle }) => {
    localStorage.setItem("aw_token", token);
    localStorage.setItem("aw_handle", handle);
  }, { token: user.token, handle: user.handle });
}

test("chip lab shows loading until the session resolves", async ({ browser }) => {
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
    await page.goto(`${srv.url}/chip.html`);
    await expect(page.locator("#session-loading")).toBeVisible();
    await expect(page.locator("#login-card")).toBeHidden();
    await expect(page.locator("#train-card")).toBeHidden();
    await expect(page.locator("#train-card")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#session-loading")).toBeHidden();
    await expect(page.locator("#model-badge")).toContainText("MOCK");
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await srv.close();
  }
});

test("chip lab invites a lost session to sign in", async ({ browser }) => {
  const srv = await startE2EServer();
  const users = seedE2E(srv.store);
  const ctx = await browser.newContext();
  await loginAs(ctx, users.alice);
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e).slice(0, 160)));
  try {
    let calls = 0;
    await page.route("**/v1/me", async (route) => {
      calls += 1;
      if (calls === 1) await route.continue();
      else await route.fulfill({ status: 401, body: "{}" });
    });
    await page.goto(`${srv.url}/chip.html`);
    await expect(page.locator("#login-card")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#login-card h2")).toContainText("Sign in to build");
    await expect(page.locator('#login-card a[href="./auth.html?next=chip.html"]')).toBeVisible();
    await expect(page.locator("#train-card")).toBeHidden();
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await srv.close();
  }
});
