import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { openStore, buildRouter } from "../src/index.ts";
import { makeCaller } from "./harness.mjs";

let call;
let store;

before(() => {
  store = openStore(":memory:");
  call = makeCaller(buildRouter({ store }));
});

describe("guided first session", () => {
  it("starts with three locked stages worth 200 AC each", async () => {
    const s = await call("POST", "/v1/auth/session", { handle: "rookie" });
    const r = await call("GET", "/v1/ftue", null, s.json.token);
    assert.equal(r.status, 200);
    assert.equal(r.json.reward, 200);
    assert.deepEqual(r.json.stages.map((x) => x.id), ["create", "program", "arena"]);
    assert.ok(r.json.stages.every((x) => x.done === false && x.claimed === false));
  });

  it("refuses claims before the act is done", async () => {
    const s = await call("POST", "/v1/auth/session", { handle: "impatient" });
    const early = await call("POST", "/v1/ftue/claim", { stage: 1 }, s.json.token);
    assert.equal(early.status, 422);
    assert.match(early.json.error, /not complete/);
    const ghost = await call("POST", "/v1/ftue/claim", { stage: 9 }, s.json.token);
    assert.equal(ghost.status, 400);
    const blank = await call("POST", "/v1/ftue/claim", {}, s.json.token);
    assert.equal(blank.status, 400);
  });

  it("pays each stage once across the full path", async () => {
    const s = await call("POST", "/v1/auth/session", { handle: "cadet" });
    const token = s.json.token;
    const bred = await call("POST", "/v1/agents", { name: "Cadet-1", concept: "patient rookie" }, token);
    const agentId = bred.json.agentId;
    const one = await call("POST", "/v1/ftue/claim", { stage: 1 }, token);
    assert.equal(one.status, 200);
    assert.equal(one.json.rewarded, true);
    assert.equal(one.json.ac, 200);
    const replay = await call("POST", "/v1/ftue/claim", { stage: 1 }, token);
    assert.equal(replay.status, 200);
    assert.equal(replay.json.rewarded, false);
    assert.equal(replay.json.ac, 200);
    const draft = await call("POST", `/v1/agents/${agentId}/policies/compile`, { prompt: "hold the center patiently" }, token);
    const noInstall = await call("POST", "/v1/ftue/claim", { stage: 2 }, token);
    assert.equal(noInstall.status, 422);
    await call("POST", `/v1/agents/${agentId}/policies/install`, { versionId: draft.json.versionId }, token);
    const two = await call("POST", "/v1/ftue/claim", { stage: 2 }, token);
    assert.equal(two.json.rewarded, true);
    assert.equal(two.json.ac, 400);
    const bout = await call("POST", "/v1/matches/training", { versionId: draft.json.versionId, seed: "ftue-1" }, token);
    assert.equal(bout.status, 201);
    const three = await call("POST", "/v1/ftue/claim", { stage: 3 }, token);
    assert.equal(three.json.rewarded, true);
    assert.equal(three.json.ac, 600);
    const dash = await call("GET", `/v1/agents/${agentId}/dashboard`, null, token);
    assert.ok(dash.json.ftue.every((x) => x.done && x.claimed));
    const txns = store.db.prepare("SELECT reason, delta FROM wallet_txns WHERE reason LIKE 'ftue stage %' ORDER BY reason").all();
    assert.deepEqual(txns.map((t) => t.delta), [200, 200, 200]);
  });
});
