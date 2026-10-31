// GDPR export plus erasure. Same bundle and cascade on both runtimes.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { openStore, buildRouter } from "../src/index.ts";
import { makeCaller } from "./harness.mjs";
import entry from "../src/worker.ts";
import { addressOfSecret, signLoginMessage } from "@agent-wars/auth";

function freshWallet() {
  const key = "0x" + Buffer.from(randomBytes(32)).toString("hex");
  return { key, address: addressOfSecret(key) };
}
const cookieOf = (headers) => String(headers["set-cookie"] ?? "").split(";")[0];

async function provision(call, handle, prompt) {
  const s = await call("POST", "/v1/auth/session", { handle });
  assert.equal(s.status, 200);
  const a = await call("POST", "/v1/agents", { name: handle, concept: "test" }, s.json.token);
  assert.equal(a.status, 201);
  const v = await call("POST", `/v1/agents/${a.json.agentId}/policies/compile`, { prompt }, s.json.token);
  assert.equal(v.status, 201);
  await call("POST", `/v1/agents/${a.json.agentId}/policies/install`, { versionId: v.json.versionId }, s.json.token);
  return { token: s.json.token, leaderId: s.json.leaderId, agentId: a.json.agentId, version: v.json.versionId };
}

describe("gdpr on the dev server", () => {
  let call;
  let store;

  before(() => {
    store = openStore(":memory:");
    call = makeCaller(buildRouter({ store }));
  });

  it("refuses export and delete without a session", async () => {
    assert.equal((await call("GET", "/v1/me/export")).status, 401);
    assert.equal((await call("DELETE", "/v1/me")).status, 401);
  });

  it("exports the full bundle with no token hashes", async () => {
    const me = await provision(call, "gdpr-export", "rush them down up close");
    const foe = await provision(call, "gdpr-foe", "evade and stay far away");
    const fight = await call("POST", "/v1/matches/ranked", {
      aVersionId: me.version, bVersionId: foe.version, seed: "gdpr-1", key: "gdpr-1",
    }, me.token);
    assert.equal(fight.status, 201);
    const r = await call("GET", "/v1/me/export", null, me.token);
    assert.equal(r.status, 200);
    assert.equal(r.json.leader.handle, "gdpr-export");
    assert.equal(r.json.agents.length, 1);
    assert.equal(r.json.versions.length, 1);
    assert.equal(r.json.matches.length, 1);
    assert.ok(r.json.walletTxns.length >= 1);
    assert.ok(Array.isArray(r.json.sessions));
    assert.ok(!JSON.stringify(r.json).includes("token_hash"));
    assert.ok(typeof r.json.exportedAt === "number");
  });

  it("deletes the account and every owned row", async () => {
    const me = await provision(call, "gdpr-gone", "rush them down up close");
    const foe = await provision(call, "gdpr-stays", "evade and stay far away");
    await call("POST", "/v1/matches/ranked", {
      aVersionId: me.version, bVersionId: foe.version, seed: "gdpr-2", key: "gdpr-2",
    }, me.token);
    await call("POST", "/v1/leaders/gdpr-gone/report", { reason: "test report" }, foe.token);
    const r = await call("DELETE", "/v1/me", null, me.token);
    assert.equal(r.status, 200);
    assert.equal(r.json.deleted, true);
    assert.equal(r.json.removed.leaders, 1);
    assert.equal(r.json.removed.agents, 1);
    assert.equal(r.json.removed.versions, 1);
    assert.equal(r.json.removed.matches, 1);
    assert.ok(String(r.headers["set-cookie"]).includes("Max-Age=0"));
    assert.equal((await call("GET", "/v1/me", null, me.token)).status, 401);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM leaders WHERE id = ?").get(me.leaderId).n, 0);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM agents WHERE leader_id = ?").get(me.leaderId).n, 0);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM wallet_txns WHERE wallet_id = ?").get(me.leaderId).n, 0);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM reports WHERE handle = ?").get("gdpr-gone").n, 0);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM leaders WHERE id = ?").get(foe.leaderId).n, 1);
  });

  it("clears wallet sessions and nonces on delete", async () => {
    const { key, address } = freshWallet();
    const c = await call("POST", "/v1/auth/challenge", { address });
    const sig = signLoginMessage(c.json.message, key);
    const r = await call("POST", "/v1/auth/wallet", { address, message: c.json.message, signature: sig, nonce: c.json.nonce });
    assert.equal(r.status, 200);
    const cookie = cookieOf(r.headers);
    assert.ok(String(r.headers["set-cookie"]).includes("Secure"));
    const me = await call("GET", "/v1/me", null, null, { cookie });
    const leaderId = me.json.leader.id;
    const d = await call("DELETE", "/v1/me", null, null, { cookie });
    assert.equal(d.status, 200);
    assert.equal((await call("GET", "/v1/me", null, null, { cookie })).status, 401);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE leader_id = ?").get(leaderId).n, 0);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM auth_nonces WHERE address = ?").get(address).n, 0);
  });
});

describe("gdpr on the worker mirror", () => {
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
  const assetsStub = { fetch: async () => new Response("shell", { headers: { "content-type": "text/html" } }) };
  let db;
  let wenv;
  let wcall;

  before(() => {
    db = new DatabaseSync(":memory:");
    for (const m of ["0001_schema", "0002_platform", "0003_matchmaking", "0004_cost_audit", "0005_portrait_status", "0006_match_payouts", "0007_tournaments", "0008_armory", "0009_season_archives", "0010_reports", "0011_version_labels", "0012_match_mode", "0013_ai_cooldowns", "0014_wallet_auth", "0015_handle_set"]) {
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

  async function wprovision(handle, prompt) {
    const s = await wcall("POST", "/v1/auth/session", { handle });
    assert.equal(s.status, 200);
    const bearer = { authorization: `Bearer ${s.json.token}` };
    const a = await wcall("POST", "/v1/agents", { name: handle, concept: "test" }, bearer);
    assert.equal(a.status, 201);
    const v = await wcall("POST", `/v1/agents/${a.json.agentId}/policies/compile`, { prompt }, bearer);
    assert.equal(v.status, 201);
    return { bearer, leaderId: s.json.leaderId, agentId: a.json.agentId, version: v.json.versionId };
  }

  it("refuses export and delete without a session", async () => {
    assert.equal((await wcall("GET", "/v1/me/export")).status, 401);
    assert.equal((await wcall("DELETE", "/v1/me")).status, 401);
  });

  it("exports the full bundle with no token hashes", async () => {
    const me = await wprovision("w-gdpr-export", "rush them down up close");
    await wprovision("w-gdpr-foe", "evade and stay far away");
    const r = await wcall("GET", "/v1/me/export", null, me.bearer);
    assert.equal(r.status, 200);
    assert.equal(r.json.leader.handle, "w-gdpr-export");
    assert.equal(r.json.agents.length, 1);
    assert.equal(r.json.versions.length, 1);
    assert.ok(!JSON.stringify(r.json).includes("token_hash"));
  });

  it("deletes the account and every owned row", async () => {
    const me = await wprovision("w-gdpr-gone", "rush them down up close");
    const foe = await wprovision("w-gdpr-stays", "evade and stay far away");
    const r = await wcall("DELETE", "/v1/me", null, me.bearer);
    assert.equal(r.status, 200);
    assert.equal(r.json.deleted, true);
    assert.equal(r.json.removed.leaders, 1);
    assert.equal(r.json.removed.agents, 1);
    assert.equal(r.json.removed.versions, 1);
    assert.equal((await wcall("GET", "/v1/me", null, me.bearer)).status, 401);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leaders WHERE id = ?").get(me.leaderId).n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agents WHERE leader_id = ?").get(me.leaderId).n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leaders WHERE id = ?").get(foe.leaderId).n, 1);
  });

  it("clears a wallet cookie session on delete", async () => {
    const { key, address } = freshWallet();
    const c = await wcall("POST", "/v1/auth/challenge", { address });
    assert.equal(c.status, 200);
    const sig = signLoginMessage(c.json.message, key);
    const r = await wcall("POST", "/v1/auth/wallet", { address, message: c.json.message, signature: sig, nonce: c.json.nonce });
    assert.equal(r.status, 200);
    const cookie = cookieOf(r.headers);
    assert.ok(String(r.headers["set-cookie"]).includes("Secure"));
    const me = await wcall("GET", "/v1/me", null, { cookie });
    assert.equal(me.status, 200);
    const leaderId = me.json.leader.id;
    const d = await wcall("DELETE", "/v1/me", null, { cookie });
    assert.equal(d.status, 200);
    assert.equal((await wcall("GET", "/v1/me", null, { cookie })).status, 401);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE leader_id = ?").get(leaderId).n, 0);
  });
});
