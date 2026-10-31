// Wallet login. Challenge, personal_sign, cookie session, logout.
// Covers the dev server and the worker mirror with the same SQL.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { openStore, buildRouter } from "../src/index.ts";
import { makeCaller } from "./harness.mjs";
import entry from "../src/worker.ts";
import { addressOfSecret, signLoginMessage } from "@agent-wars/auth";

// Fresh wallet per test. Auth rate-limits by address, so sharing one
// address across tests would trip the limiter instead of the product.
function freshWallet() {
  const key = "0x" + Buffer.from(randomBytes(32)).toString("hex");
  return { key, address: addressOfSecret(key) };
}
const W_A = freshWallet();
const KEY_A = W_A.key;
const ADDR_A = W_A.address;
const W_B = freshWallet();
const KEY_B = W_B.key;
const ADDR_B = W_B.address;

const cookieOf = (headers) => String(headers["set-cookie"] ?? "").split(";")[0];

describe("wallet login on the dev server", () => {
  let call;
  let store;

  before(() => {
    store = openStore(":memory:");
    call = makeCaller(buildRouter({ store }));
  });

  async function login(key, address) {
    const c = await call("POST", "/v1/auth/challenge", { address });
    assert.equal(c.status, 200);
    const sig = signLoginMessage(c.json.message, key);
    return call("POST", "/v1/auth/wallet", { address, message: c.json.message, signature: sig, nonce: c.json.nonce });
  }

  it("rejects a malformed address at challenge", async () => {
    const r = await call("POST", "/v1/auth/challenge", { address: "0x123" });
    assert.equal(r.status, 400);
  });

  it("issues a challenge bound to address and domain", async () => {
    const { address } = freshWallet();
    const r = await call("POST", "/v1/auth/challenge", { address });
    assert.equal(r.status, 200);
    assert.ok(r.json.message.includes(address));
    assert.ok(r.json.message.includes(`Nonce: ${r.json.nonce}`));
    const row = store.db.prepare("SELECT * FROM auth_nonces WHERE nonce = ?").get(r.json.nonce);
    assert.equal(row.address, address);
  });

  it("creates a leader on first login and sets a cookie", async () => {
    const { key, address } = freshWallet();
    const r = await login(key, address);
    assert.equal(r.status, 200);
    assert.ok(r.json.leaderId);
    assert.ok(cookieOf(r.headers).startsWith("aw_session=sess_"));
    const leader = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(r.json.leaderId);
    assert.equal(leader.wallet_address, address);
  });

  it("returns the same leader on repeat login", async () => {
    const { key, address } = freshWallet();
    const first = await login(key, address);
    const second = await login(key, address);
    assert.equal(second.json.leaderId, first.json.leaderId);
  });

  it("serves /v1/me from the cookie", async () => {
    const { key, address } = freshWallet();
    const r = await login(key, address);
    const me = await call("GET", "/v1/me", null, null, { cookie: cookieOf(r.headers) });
    assert.equal(me.status, 200);
    assert.equal(me.json.leader.wallet_address, address);
  });

  it("rejects a replayed nonce", async () => {
    const { key, address } = freshWallet();
    const c = await call("POST", "/v1/auth/challenge", { address });
    const sig = signLoginMessage(c.json.message, key);
    const body = { address, message: c.json.message, signature: sig, nonce: c.json.nonce };
    assert.equal((await call("POST", "/v1/auth/wallet", body)).status, 200);
    assert.equal((await call("POST", "/v1/auth/wallet", body)).status, 401);
  });

  it("rejects a foreign signature", async () => {
    const victim = freshWallet();
    const other = freshWallet();
    const c = await call("POST", "/v1/auth/challenge", { address: victim.address });
    const sig = signLoginMessage(c.json.message, other.key);
    const r = await call("POST", "/v1/auth/wallet", { address: victim.address, message: c.json.message, signature: sig, nonce: c.json.nonce });
    assert.equal(r.status, 401);
  });

  it("rejects a tampered message", async () => {
    const { key, address } = freshWallet();
    const c = await call("POST", "/v1/auth/challenge", { address });
    const sig = signLoginMessage(c.json.message, key);
    const r = await call("POST", "/v1/auth/wallet", { address, message: c.json.message + " ", signature: sig, nonce: c.json.nonce });
    assert.equal(r.status, 401);
  });

  it("rejects an expired challenge", async () => {
    const { key, address } = freshWallet();
    const c = await call("POST", "/v1/auth/challenge", { address });
    store.db.prepare("UPDATE auth_nonces SET expires_at = ? WHERE nonce = ?").run(1, c.json.nonce);
    const sig = signLoginMessage(c.json.message, key);
    const r = await call("POST", "/v1/auth/wallet", { address, message: c.json.message, signature: sig, nonce: c.json.nonce });
    assert.equal(r.status, 401);
  });

  it("logs out and kills the session", async () => {
    const { key, address } = freshWallet();
    const r = await login(key, address);
    const cookie = cookieOf(r.headers);
    assert.equal((await call("GET", "/v1/me", null, null, { cookie })).status, 200);
    const out = await call("POST", "/v1/auth/logout", null, null, { cookie });
    assert.equal(out.status, 200);
    assert.ok(String(out.headers["set-cookie"]).includes("Max-Age=0"));
    assert.equal((await call("GET", "/v1/me", null, null, { cookie })).status, 401);
  });

  it("refuses expired sessions", async () => {
    const { key, address } = freshWallet();
    const r = await login(key, address);
    const token = cookieOf(r.headers).split("=")[1];
    const { hashToken } = await import("@agent-wars/auth");
    store.db.prepare("UPDATE auth_sessions SET expires_at = 1 WHERE token_hash = ?").run(hashToken(token));
    assert.equal((await call("GET", "/v1/me", null, null, { cookie: cookieOf(r.headers) })).status, 401);
  });

  it("keeps legacy Bearer [REDACTED] working", async () => {
    const s = await call("POST", "/v1/auth/session", { handle: "wallet-legacy" });
    assert.equal((await call("GET", "/v1/me", null, s.json.token)).status, 200);
  });
});

describe("wallet login on the worker mirror", () => {
  const shim = (db) => ({
    prepare: (query) => ({
      bind: (...values) => ({
        first: async () => db.prepare(query).get(...values) ?? null,
        all: async () => ({ results: db.prepare(query).all(...values) }),
        run: async () => db.prepare(query).run(...values),
      }),
    }),
    batch: async (stmts) => {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  });
  const assetsStub = {
    lastUrl: "",
    fetch: async (req) => {
      assetsStub.lastUrl = req.url;
      return new Response("shell", { headers: { "content-type": "text/html" } });
    },
  };
  let db;
  let wenv;
  let wcall;

  before(() => {
    db = new DatabaseSync(":memory:");
    for (const m of ["0001_schema", "0002_platform", "0003_matchmaking", "0004_cost_audit", "0005_portrait_status", "0006_match_payouts", "0007_tournaments", "0008_armory", "0009_season_archives", "0010_reports", "0011_version_labels", "0012_match_mode", "0013_ai_cooldowns", "0014_wallet_auth"]) {
      db.exec(readFileSync(new URL(`../../../migrations/${m}.sql`, import.meta.url), "utf8"));
    }
    wenv = { DB: shim(db), ASSETS: assetsStub };
    wcall = (method, path, body, headers = {}) => entry.fetch(
      new Request(`http://local${path}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
      }),
      wenv,
    ).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null), headers: Object.fromEntries(r.headers.entries()) }));
  });

  it("runs challenge, login, cookie me, and logout", async () => {
    const c = await wcall("POST", "/v1/auth/challenge", { address: ADDR_B });
    assert.equal(c.status, 200);
    const sig = signLoginMessage(c.json.message, KEY_B);
    const r = await wcall("POST", "/v1/auth/wallet", { address: ADDR_B, message: c.json.message, signature: sig, nonce: c.json.nonce });
    assert.equal(r.status, 200);
    const cookie = cookieOf(r.headers);
    assert.ok(cookie.startsWith("aw_session=sess_"));
    const me = await wcall("GET", "/v1/me", null, { cookie });
    assert.equal(me.status, 200);
    assert.equal(me.json.leader.wallet_address, ADDR_B);
    const out = await wcall("POST", "/v1/auth/logout", null, { cookie });
    assert.equal(out.status, 200);
    assert.equal((await wcall("GET", "/v1/me", null, { cookie })).status, 401);
  });

  it("serves the wallet page at /auth", async () => {
    const r = await wcall("GET", "/auth");
    assert.equal(r.status, 200);
    assert.ok(assetsStub.lastUrl.endsWith("/auth.html"));
  });

  it("rejects a foreign signature", async () => {
    const c = await wcall("POST", "/v1/auth/challenge", { address: ADDR_B });
    const sig = signLoginMessage(c.json.message, KEY_A);
    const r = await wcall("POST", "/v1/auth/wallet", { address: ADDR_B, message: c.json.message, signature: sig, nonce: c.json.nonce });
    assert.equal(r.status, 401);
  });
});
