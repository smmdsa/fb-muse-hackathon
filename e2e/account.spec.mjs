// Account end to end. Legal footers on every key page, the GDPR
// export download, full account deletion, and the wallet-login
// barracks identity. Run it with `pnpm e2e` from the repo root.

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "playwright/test";
import { startE2EServer } from "./serve.mjs";
import { seedE2E } from "./fixtures.mjs";
import { addressOfSecret, signLoginMessage } from "../packages/auth/src/index.ts";

async function loginAs(context, user) {
  await context.addInitScript(({ token, handle }) => {
    localStorage.setItem("aw_token", token);
    localStorage.setItem("aw_handle", handle);
  }, { token: user.token, handle: user.handle });
}

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

async function deleteFromBarracks(page) {
  await expect(page.locator("#gdpr-card")).toBeVisible({ timeout: 15000 });
  await page.click("#delete-btn");
  await expect(page.locator("#delete-confirm")).toBeVisible();
  await expect(page.locator("#delete-final")).toBeDisabled();
  await page.fill("#delete-input", "DELETE");
  await expect(page.locator("#delete-final")).toBeEnabled();
  await page.click("#delete-final");
  await page.waitForURL("**/auth.html", { timeout: 15000 });
}

test("legal footer links ride every key page and open the legal pages", async ({ browser }) => {
  const srv = await startE2EServer();
  const users = seedE2E(srv.store);
  const ctx = await browser.newContext();
  await loginAs(ctx, users.alice);
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e).slice(0, 160)));
  try {
    const pages = [
      "index.html", "profile.html", "arena.html", "chip.html", "armory.html",
      "tournaments.html", "auth.html", "public.html", "privacy.html", "terms.html",
    ];
    for (const name of pages) {
      await page.goto(`${srv.url}/${name}`);
      await expect(page.locator(".legal-foot")).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.legal-foot a[href="./privacy.html"]')).toHaveText("Privacy");
      await expect(page.locator('.legal-foot a[href="./terms.html"]')).toHaveText("Terms");
      expect(page.url()).toContain(name);
    }
    await page.goto(`${srv.url}/profile.html`);
    await page.locator('.legal-foot a[href="./privacy.html"]').click();
    await page.waitForURL("**/privacy.html", { timeout: 10000 });
    await expect(page.locator("h1")).toContainText("PRIVACY");
    await expect(page.locator("main")).toContainText("Your rights");
    await page.goto(`${srv.url}/arena.html`);
    await page.locator('.legal-foot a[href="./terms.html"]').click();
    await page.waitForURL("**/terms.html", { timeout: 10000 });
    await expect(page.locator("h1")).toContainText("TERMS");
    await expect(page.locator("main")).toContainText("Termination");
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await srv.close();
  }
});

test("barracks export downloads the full bundle with no token hashes", async ({ browser }) => {
  const srv = await startE2EServer();
  const users = seedE2E(srv.store);
  const ctx = await browser.newContext({ acceptDownloads: true });
  await loginAs(ctx, users.alice);
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e).slice(0, 160)));
  try {
    await page.goto(`${srv.url}/profile.html`);
    await expect(page.locator("#gdpr-card")).toBeVisible({ timeout: 15000 });
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      page.click("#export-btn"),
    ]);
    expect(download.suggestedFilename()).toBe("agent-wars-export.json");
    const text = await readFile(await download.path(), "utf8");
    const bundle = JSON.parse(text);
    expect(bundle.leader.handle).toBe("e2e-alice");
    expect(bundle.agents.length).toBe(1);
    expect(bundle.versions.length).toBe(1);
    expect(bundle.matches.length).toBeGreaterThanOrEqual(1);
    expect(bundle.walletTxns.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(bundle.sessions)).toBe(true);
    expect(typeof bundle.exportedAt).toBe("number");
    expect(text.includes("token_hash")).toBe(false);
    await expect(page.locator("#gdpr-msg")).toContainText("Export downloaded");
    await expect(page.locator("#gdpr-msg")).toBeVisible();
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await srv.close();
  }
});

test("delete wipes the account and kills the token session", async ({ browser }) => {
  const srv = await startE2EServer();
  const users = seedE2E(srv.store);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const bad = [];
  page.on("pageerror", (e) => bad.push(String(e).slice(0, 160)));
  try {
    // Seed storage once on an open page. An init script would
    // re-plant the token after the delete wipes it.
    await page.goto(`${srv.url}/public.html`);
    await page.evaluate(({ token, handle }) => {
      localStorage.setItem("aw_token", token);
      localStorage.setItem("aw_handle", handle);
    }, { token: users.alice.token, handle: users.alice.handle });
    await page.goto(`${srv.url}/profile.html`);
    await deleteFromBarracks(page);
    // The old token is dead on the server.
    const me = await page.request.get(`${srv.url}/v1/me`, {
      headers: { authorization: `Bearer ${users.alice.token}` },
    });
    expect(me.status()).toBe(401);
    // The browser forgot the token and the handle too.
    expect(await page.evaluate(() => localStorage.getItem("aw_token"))).toBe(null);
    expect(await page.evaluate(() => localStorage.getItem("aw_handle"))).toBe(null);
    // Every owned row is gone. The foe is untouched.
    const db = srv.store.db;
    const count = (table, col, id) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(id).n;
    expect(count("leaders", "id", "e2e-alice")).toBe(0);
    expect(count("agents", "leader_id", "e2e-alice")).toBe(0);
    expect(count("wallet_txns", "wallet_id", "e2e-alice")).toBe(0);
    expect(count("auth_sessions", "leader_id", "e2e-alice")).toBe(0);
    expect(count("leaders", "id", "e2e-bob")).toBe(1);
    // The login wall bounces private pages now.
    await page.goto(`${srv.url}/arena.html`);
    await page.waitForURL("**/auth.html**", { timeout: 15000 });
    expect(page.url()).toContain("next=arena.html");
    // The public card is gone.
    await page.goto(`${srv.url}/public.html?handle=e2e-alice`);
    await expect(page.locator("#missing")).toBeVisible({ timeout: 10000 });
    // The wallet page shows a clean signed-out state.
    await page.goto(`${srv.url}/auth.html`);
    await expect(page.locator("#pill-who")).toContainText("signed out");
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await srv.close();
  }
});

test("wallet login lands in the barracks under the claimed handle", async ({ browser }) => {
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
    await page.click("#connect-btn");
    await expect(page.locator("#sign-btn")).toBeVisible();
    await page.click("#sign-btn");
    await page.waitForURL("**/handle.html", { timeout: 15000 });
    await expect(page.locator("#handle-input")).toBeEnabled({ timeout: 10000 });
    await page.fill("#handle-input", "e2e_ident");
    await expect(page.locator("#claim-btn")).toBeEnabled({ timeout: 10000 });
    await page.click("#claim-btn");
    await expect(page.locator("#handle-done")).toBeVisible();
    await page.click("#continue-btn");
    await page.waitForURL("**/profile.html", { timeout: 15000 });
    // The barracks pill shows the claimed handle. No logged-out state.
    await expect(page.locator("#pill-who")).toHaveText("e2e_ident", { timeout: 10000 });
    expect(await page.locator("#pill-who").getAttribute("data-state")).toBe("in");
    await expect(page.locator("#pill-who a")).toHaveCount(0);
    await expect(page.locator("#login-card")).toBeHidden();
    await expect(page.locator("#gdpr-card")).toBeVisible();
    const me = await page.request.get(`${srv.url}/v1/me`);
    expect(me.status()).toBe(200);
    const body = await me.json();
    expect(body.leader.handle).toBe("e2e_ident");
    const leaderId = body.leader.id;
    // The identity holds on the arena page too.
    await page.goto(`${srv.url}/arena.html`);
    await expect(page.locator("#pill-who")).toHaveText("e2e_ident", { timeout: 10000 });
    // Delete from the barracks kills the wallet cookie session.
    await page.goto(`${srv.url}/profile.html`);
    await deleteFromBarracks(page);
    const gone = await page.request.get(`${srv.url}/v1/me`);
    expect(gone.status()).toBe(401);
    const db = srv.store.db;
    const count = (table, col, id) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(id).n;
    expect(count("leaders", "id", leaderId)).toBe(0);
    expect(count("auth_sessions", "leader_id", leaderId)).toBe(0);
    expect(count("auth_nonces", "address", address)).toBe(0);
    await page.goto(`${srv.url}/public.html?handle=e2e_ident`);
    await expect(page.locator("#missing")).toBeVisible({ timeout: 10000 });
    expect(bad).toEqual([]);
  } finally {
    await ctx.close();
    await srv.close();
  }
});
