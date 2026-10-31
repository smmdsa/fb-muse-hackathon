// Handle claim. Availability probe, one-time claim, duplicate safety.
// Covers the dev server and the worker mirror with the same SQL.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { openStore, buildRouter } from "../src/index.ts";
import { makeCaller } from "./harness.mjs";
import entry from "../src/worker.ts";

describe("handle claim on the dev server", () => {
  let call;
  let store;

  before(() => {
    store = openStore(":memory:");
    call = makeCaller(buildRouter({ store }));
  });

  async function session(handle) {
    const r = await call("POST", "/v1/auth/session", { handle });
    assert.equal(r.status, 200);
    return r.json.token;
  }

  it("reports a free name as available without auth", async () => {
    const r = await call("GET", "/v1/handles/available?name=fresh_rider_1");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { name: "fresh_rider_1", valid: true, available: true });
  });

  it("reports a taken name", async () => {
    await session("taken_rider");
    const r = await call("GET", "/v1/handles/available?name=taken_rider");
    assert.equal(r.status, 200);
    assert.equal(r.json.valid, true);
    assert.equal(r.json.available, false);
    assert.equal(r.json.error, "that name is taken");
  });

  it("rejects bad shapes and reserved names before the index", async () => {
    const short = await call("GET", "/v1/handles/available?name=ab");
    assert.equal(short.json.valid, false);
    assert.equal(short.json.available, false);
    const reserved = await call("GET", "/v1/handles/available?name=ADMIN");
    assert.equal(reserved.json.name, "admin");
    assert.equal(reserved.json.valid, false);
    const missing = await call("GET", "/v1/handles/available");
    assert.equal(missing.json.valid, false);
  });

  it("marks legacy sessions as set", async () => {
    const token = await session("old_soul");
    const me = await call("GET", "/v1/me", null, token);
    assert.equal(me.status, 200);
    assert.equal(me.json.handleSet, true);
  });

  it("claims a name once and flags it set", async () => {
    store.db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run("lh1", "lh1_addr", "tok-lh1");
    const r = await call("POST", "/v1/me/handle", { handle: "  Fresh_Rider_2 " }, "tok-lh1");
    assert.equal(r.status, 200);
    assert.equal(r.json.handle, "fresh_rider_2");
    const row = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get("lh1");
    assert.equal(row.handle, "fresh_rider_2");
    assert.equal(row.handle_set, 1);
    const me = await call("GET", "/v1/me", null, "tok-lh1");
    assert.equal(me.json.handleSet, true);
  });

  it("refuses a duplicate claim with 409", async () => {
    store.db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run("lh2", "lh2_addr", "tok-lh2");
    const r = await call("POST", "/v1/me/handle", { handle: "fresh_rider_2" }, "tok-lh2");
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "that name is taken");
    const row = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get("lh2");
    assert.equal(row.handle, "lh2_addr");
    assert.equal(row.handle_set, 0);
  });

  it("refuses invalid claims with 422", async () => {
    store.db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run("lh3", "lh3_addr", "tok-lh3");
    assert.equal((await call("POST", "/v1/me/handle", { handle: "ab" }, "tok-lh3")).status, 422);
    const reserved = await call("POST", "/v1/me/handle", { handle: "system" }, "tok-lh3");
    assert.equal(reserved.status, 422);
    assert.equal(reserved.json.error, "that name is reserved");
  });

  it("requires auth for claim", async () => {
    assert.equal((await call("POST", "/v1/me/handle", { handle: "no_auth_name" })).status, 401);
  });
});

describe("handle claim on the worker mirror", () => {
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

  let db;
  let wenv;
  let wcall;

  before(() => {
    db = new DatabaseSync(":memory:");
    for (const m of ["0001_schema", "0002_platform", "0003_matchmaking", "0004_cost_audit", "0005_portrait_status", "0006_match_payouts", "0007_tournaments", "0008_armory", "0009_season_archives", "0010_reports", "0011_version_labels", "0012_match_mode", "0013_ai_cooldowns", "0014_wallet_auth", "0015_handle_set"]) {
      db.exec(readFileSync(new URL(`../../../migrations/${m}.sql`, import.meta.url), "utf8"));
    }
    wenv = { DB: shim(db), ASSETS: { fetch: async () => new Response("shell") } };
    wcall = (method, path, body, headers = {}) => entry.fetch(
      new Request(`http://local${path}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
      }),
      wenv,
    ).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  });

  it("probes, claims, and refuses a duplicate", async () => {
    const free = await wcall("GET", "/v1/handles/available?name=worker_rider");
    assert.equal(free.status, 200);
    assert.deepEqual(free.json, { name: "worker_rider", valid: true, available: true });
    db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run("wh1", "wh1_addr", "wtok-1");
    db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run("wh2", "wh2_addr", "wtok-2");
    const claim = await wcall("POST", "/v1/me/handle", { handle: "worker_rider" }, { authorization: "Bearer wtok-1" });
    assert.equal(claim.status, 200);
    const dup = await wcall("POST", "/v1/me/handle", { handle: "worker_rider" }, { authorization: "Bearer wtok-2" });
    assert.equal(dup.status, 409);
    const taken = await wcall("GET", "/v1/handles/available?name=worker_rider");
    assert.equal(taken.json.available, false);
    const me = await wcall("GET", "/v1/me", null, { authorization: "Bearer wtok-1" });
    assert.equal(me.json.handleSet, true);
  });
});
