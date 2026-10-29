import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { openStore, buildRouter } from "../src/index.ts";
import { makeCaller } from "./harness.mjs";

let call;
let store;
let a;
let b;

async function leader(handle, prompt) {
  const s = await call("POST", "/v1/auth/session", { handle });
  const g = await call("POST", "/v1/agents", {}, s.json.token);
  const v = await call("POST", `/v1/agents/${g.json.agentId}/policies/compile`, { prompt }, s.json.token);
  await call("POST", `/v1/agents/${g.json.agentId}/policies/install`, { versionId: v.json.versionId }, s.json.token);
  return { token: s.json.token, version: v.json.versionId };
}

before(() => {
  store = openStore(":memory:");
  call = makeCaller(buildRouter({ store }));
});

describe("public profiles", () => {
  it("provisions two fighters", async () => {
    a = await leader("pub-alpha", "rush them down up close");
    b = await leader("pub-bravo", "evade and stay far away");
    assert.ok(a.version && b.version);
  });

  it("plays one ranked bout for a career record", async () => {
    const r = await call(
      "POST",
      "/v1/matches/ranked",
      { aVersionId: a.version, bVersionId: b.version, seed: "pub-1", key: "pub-1" },
      a.token,
    );
    assert.equal(r.status, 201);
  });

  it("serves a career card with no secrets and no auth", async () => {
    const r = await call("GET", "/v1/leaders/pub-alpha/public");
    assert.equal(r.status, 200);
    assert.equal(r.json.handle, "pub-alpha");
    assert.equal(typeof r.json.ap, "number");
    assert.ok(r.json.tier);
    // Draws count for neither side, so the card sums decisive bouts only.
    const row = store.db.prepare("SELECT winner FROM matches WHERE id = ?").get("pub-1");
    assert.equal(r.json.agent.wins + r.json.agent.losses, row.winner === "DRAW" ? 0 : 1);
    const raw = JSON.stringify(r.json);
    for (const banned of ["token", "energy", "lease", "wallet", "autobattle", "ac\"", "rp\""]) {
      assert.ok(!raw.includes(banned), `leaked ${banned}`);
    }
  });

  it("404s unknown handles", async () => {
    const r = await call("GET", "/v1/leaders/nobody-here/public");
    assert.equal(r.status, 404);
  });

  it("accepts an abuse report and stores it privately", async () => {
    const r = await call("POST", "/v1/leaders/pub-alpha/report", { reason: "spam bio" }, b.token);
    assert.equal(r.status, 200);
    assert.equal(r.json.received, true);
    const row = store.db.prepare("SELECT * FROM reports WHERE handle = ?").get("pub-alpha");
    assert.equal(row.reason, "spam bio");
  });

  it("rejects empty reasons and unknown handles", async () => {
    const empty = await call("POST", "/v1/leaders/pub-alpha/report", { reason: "" }, b.token);
    assert.equal(empty.status, 400);
    const ghost = await call("POST", "/v1/leaders/nobody-here/report", { reason: "x" }, b.token);
    assert.equal(ghost.status, 404);
  });

  it("requires auth for reports", async () => {
    const r = await call("POST", "/v1/leaders/pub-alpha/report", { reason: "anon spam" });
    assert.equal(r.status, 401);
  });
});
