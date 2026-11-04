// Paper end to end. The design paper loads open, names the
// Meta pipeline, and reports the live compiler status.
import { expect, test } from "playwright/test";
import { startE2EServer } from "./serve.mjs";

test("paper loads open with the compiler badge", async ({ browser }) => {
  const srv = await startE2EServer();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e).slice(0, 160)));
  try {
    await page.goto(`${srv.url}/paper.html`);
    await expect(page.locator("h1")).toContainText("PAPER");
    expect(page.url()).toContain("paper.html");
    await expect(page.locator("main")).toContainText("compiler, not a chatbot");
    await expect(page.locator("main")).toContainText("Reuse checklist");
    await expect(page.locator("#paper-model")).toContainText("COMPILER", { timeout: 15000 });
    await expect(page.locator("#paper-model")).toContainText("MOCK");
    await expect(page.locator('.legal-foot a[href="./privacy.html"]')).toBeVisible();
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await srv.close();
  }
});
