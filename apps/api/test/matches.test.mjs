import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { openStore, buildRouter } from "../src/index.ts";
import { makeCaller } from "./harness.mjs";

let call;
let keys = {};
let store;

async function leader(handle, prompt) {
  const s = await call("POST", "/v1/auth/session", { handle });
  const a = await call("POST", "/v1/agents", {}, s.json.token);
  const v = await call("POST", `/v1/agents/${a.json.agentId}/policies/compile`, { prompt }, s.json.token);
  return { token: s.json.token, version: v.json.versionId };
}

before(() => {
  store = openStore(":memory:");
  call = makeCaller(buildRouter({ store }));
});

describe("matches", () => {
  it("provisions two leaders", async () => {
    keys.a = await leader("alpha", "rush them down up close");
    keys.b = await leader("bravo", "evade and stay far away");
    assert.ok(keys.a.version);
    assert.ok(keys.b.version);
  });

  it("runs training without moving AP", async () => {
    const r = await call("POST", "/v1/matches/training", { versionId: keys.a.version, seed: "train-1" }, keys.a.token);
    assert.equal(r.status, 201);
    assert.ok(r.json.checksum);
    const me = await call("GET", "/v1/me", null, keys.a.token);
    assert.equal(me.json.leader.ap, 500);
    assert.equal(me.json.energy.energy, 10);
  });

  it("settles ranked with AP, pay, and replay", async () => {
    const r = await call(
      "POST",
      "/v1/matches/ranked",
      { aVersionId: keys.a.version, bVersionId: keys.b.version, seed: "rank-1", key: "rank-1" },
      keys.a.token,
    );
    assert.equal(r.status, 201);
    assert.ok(Math.abs(r.json.deltaA) >= 12 && Math.abs(r.json.deltaA) <= 28);
    assert.equal(r.json.deltaB, -r.json.deltaA);
    const me = await call("GET", "/v1/me", null, keys.a.token);
    assert.equal(me.json.leader.ap, 500 + r.json.deltaA);
    const replay = await call("GET", "/v1/matches/rank-1/replay", null, keys.a.token);
    assert.equal(replay.status, 200);
    assert.equal(replay.json.identical, true);
    const board = await call("GET", "/v1/leaderboard", null, keys.a.token);
    assert.equal(board.status, 200);
    assert.ok(Array.isArray(board.json.rows));
    assert.equal(board.json.rows.length, 0);
  });

  it("dedupes a repeated ranked key", async () => {
    const again = await call(
      "POST",
      "/v1/matches/ranked",
      { aVersionId: keys.a.version, bVersionId: keys.b.version, seed: "rank-1", key: "rank-1" },
      keys.a.token,
    );
    assert.equal(again.json.deduped, true);
  });

  it("denies a self match", async () => {
    const r = await call(
      "POST",
      "/v1/matches/ranked",
      { aVersionId: keys.a.version, bVersionId: keys.a.version, seed: "self-1", key: "self-1" },
      keys.a.token,
    );
    assert.equal(r.status, 422);
  });

  it("spends one energy per ranked fight", async () => {
    const me = await call("GET", "/v1/me", null, keys.a.token);
    assert.equal(me.json.energy.energy, 9);
  });

  it("denies ranked at zero energy", async () => {
    for (let i = 2; i <= 10; i += 1) {
      const r = await call(
        "POST",
        "/v1/matches/ranked",
        { aVersionId: keys.a.version, bVersionId: keys.b.version, seed: `rank-${i}`, key: `rank-${i}` },
        keys.a.token,
      );
      assert.equal(r.status, 201);
    }
    const out = await call(
      "POST",
      "/v1/matches/ranked",
      { aVersionId: keys.a.version, bVersionId: keys.b.version, seed: "rank-11", key: "rank-11" },
      keys.a.token,
    );
    assert.equal(out.status, 409);
    assert.match(out.json.error, /energy empty/);
  });
});
