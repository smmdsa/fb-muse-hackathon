// Wallet login end to end. A stub wallet plus a node-side signer
// drive the real pages: connect, sign, handle claim, barracks,
// then the login wall: private pages bounce, public stays open.
import { randomBytes } from "node:crypto";
import { expect, test } from "playwright/test";
import { startE2EServer } from "./serve.mjs";
import { addressOfSecret, signLoginMessage } from "../packages/auth/src/index.ts";

async function stubWallet(ctx, key, address) {
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
}

test("wallet connect, sign, handle claim, and logout", async ({ browser }) => {
  const srv = await startE2EServer();
  const key = "0x" + Buffer.from(randomBytes(32)).toString("hex");
  const address = addressOfSecret(key);
  const ctx = await browser.newContext();
  await stubWallet(ctx, key, address);
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e).slice(0, 160)));
  try {
    await page.goto(`${srv.url}/auth.html`);
    await expect(page.locator("#connect-btn")).toBeVisible();
    await page.click("#connect-btn");
    await expect(page.locator("#sign-btn")).toBeVisible();
    await page.click("#sign-btn");
    await page.waitForURL("**/handle.html", { timeout: 15000 });
    const cookies = await ctx.cookies();
    const session = cookies.find((c) => c.name === "aw_session");
    expect(session).toBeTruthy();
    expect(session.httpOnly).toBe(true);

    await expect(page.locator("#handle-input")).toBeEnabled({ timeout: 10000 });
    await page.fill("#handle-input", "e2e_rider");
    await expect(page.locator("#claim-btn")).toBeEnabled({ timeout: 10000 });
    await page.click("#claim-btn");
    await expect(page.locator("#handle-done")).toBeVisible();
    await expect(page.locator("#handle-name")).toContainText("e2e_rider");
    await expect(page.locator("#confetti")).toBeVisible();
    await page.click("#continue-btn");
    await page.waitForURL("**/profile.html", { timeout: 15000 });

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
    await srv.close();
  }
});

test("login wall bounces private pages and keeps public open", async ({ browser }) => {
  const srv = await startE2EServer();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e).slice(0, 160)));
  try {
    await page.goto(`${srv.url}/arena.html`);
    await page.waitForURL("**/auth.html**", { timeout: 15000 });
    expect(page.url()).toContain("next=arena.html");
    await page.goto(`${srv.url}/public.html`);
    await page.waitForTimeout(1500);
    expect(page.url()).toContain("public.html");
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await srv.close();
  }
});
