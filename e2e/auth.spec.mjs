// Wallet login end to end. A stub wallet plus a node-side signer
// drive the real page: connect, sign, cookie, logout.
import { randomBytes } from "node:crypto";
import { expect, test } from "playwright/test";
import { startE2EServer } from "./serve.mjs";
import { addressOfSecret, signLoginMessage } from "../packages/auth/src/index.ts";

test("wallet connect, sign, cookie session, and logout", async ({ browser }) => {
  const srv = await startE2EServer();
  const key = "0x" + Buffer.from(randomBytes(32)).toString("hex");
  const address = addressOfSecret(key);
  const ctx = await browser.newContext();
  await ctx.exposeFunction("e2eSign", ({ message }) => signLoginMessage(message, key));
  await ctx.addInitScript((addr) => {
    window.ethereum = {
      request: async ({ method, params }) => {
        if (method === "eth_requestAccounts") return [addr];
        if (method === "personal_sign") return window.e2eSign({ message: params[0] });
        throw new Error(`stub: no ${method}`);
      },
    };
  }, address);
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e).slice(0, 160)));
  try {
    await page.goto(`${srv.url}/auth.html`);
    await expect(page.locator("#connect-btn")).toBeVisible();
    await page.click("#connect-btn");
    await expect(page.locator("#sign-btn")).toBeVisible();
    await page.click("#sign-btn");
    await page.waitForURL("**/arena.html", { timeout: 15000 });
    const cookies = await ctx.cookies();
    const session = cookies.find((c) => c.name === "aw_session");
    expect(session).toBeTruthy();
    expect(session.httpOnly).toBe(true);

    await page.goto(`${srv.url}/auth.html`);
    await expect(page.locator("#pill-who")).not.toContainText("signed out");
    await expect(page.locator("#logout-btn")).toBeVisible();
    const me = await page.request.get(`${srv.url}/v1/me`);
    expect(me.status()).toBe(200);
    expect((await me.json()).leader.wallet_address).toBe(address);

    await page.click("#logout-btn");
    await expect(page.locator("#pill-who")).toContainText("signed out");
    const gone = await page.request.get(`${srv.url}/v1/me`);
    expect(gone.status()).toBe(401);
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await browser.close();
    await srv.close();
  }
});
