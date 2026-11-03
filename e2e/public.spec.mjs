// Public card end to end. The card shows stats and fight history
// with a framed portrait, and the payload carries no chip prompt.
import { expect, test } from "playwright/test";
import { startE2EServer } from "./serve.mjs";
import { seedE2E } from "./fixtures.mjs";

test("fighter card shows stats, history, and no prompt", async ({ browser, request }) => {
  const srv = await startE2EServer();
  seedE2E(srv.store);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e).slice(0, 160)));
  try {
    const api = await request.get(`${srv.url}/v1/leaders/e2e-alice/public`);
    expect(api.status()).toBe(200);
    const body = await api.text();
    expect(body.includes("policy_json")).toBe(false);
    expect(body.includes("prompt")).toBe(false);
    const card = JSON.parse(body);
    expect(card.history.length).toBeGreaterThanOrEqual(1);
    expect(typeof card.stats.winRate).toBe("number");

    await page.goto(`${srv.url}/public.html?handle=e2e-alice`);
    await expect(page.locator("#card")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#card-name")).toContainText("ALICE");
    await expect(page.locator("#card-stats .card-stat")).toHaveCount(3);
    await expect(page.locator("#card-history .hist-row").first()).toBeVisible();
    const shot = await page.locator("#card-img").evaluate((img) => ({
      w: img.clientWidth, h: img.clientHeight, over: img.scrollWidth > img.clientWidth + 1,
    }));
    expect(shot.w).toBeGreaterThan(0);
    expect(shot.h).toBeGreaterThan(0);
    expect(shot.over).toBe(false);
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await srv.close();
  }
});
