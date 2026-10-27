import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { openStore, buildRouter } from "../src/index.ts";
import { makeCaller } from "./harness.mjs";

let call;
let store;
let leader;
const PROMPT_A = "rush them down up close";
const PROMPT_B = "evade and stay far away";

before(() => {
  store = openStore(":memory:");
  call = makeCaller(buildRouter({ store }));
});

describe("evolution lab", () => {
  it("provisions a leader with a hero", async () => {
    const s = await call("POST", "/v1/auth/session", { handle: "lab-rat" });
    const g = await call("POST", "/v1/agents", {}, s.json.token);
    leader = { token: s.json.token, agentId: g.json.agentId };
    assert.ok(leader.agentId);
  });

  it("refuses a verdict on a tiny sample", async () => {
    const r = await call("POST", "/v1/lab/ab", {
      agentId: leader.agentId, promptA: PROMPT_A, promptB: PROMPT_B, bouts: 4,
    }, leader.token);
    assert.equal(r.status, 201);
    assert.equal(r.json.bouts, 4);
    assert.equal(r.json.winsA + r.json.drawsA <= 4, true);
    assert.equal(r.json.winsB + r.json.drawsB <= 4, true);
    assert.match(r.json.verdict, /sample too small/);
  });

  it("runs a full A/B and names only grounded verdicts", async () => {
    const r = await call("POST", "/v1/lab/ab", {
      agentId: leader.agentId, promptA: PROMPT_A, promptB: PROMPT_B, bouts: 10,
    }, leader.token);
    assert.equal(r.status, 201);
    assert.equal(r.json.bouts, 10);
    assert.equal(r.json.winsA + r.json.drawsA <= 10, true);
    assert.equal(r.json.winsB + r.json.drawsB <= 10, true);
    assert.ok(["A leads", "B leads", "too close to call"].includes(r.json.verdict));
    const stored = store.db.prepare("SELECT COUNT(*) AS n FROM matches WHERE seed LIKE 'lab%'").get();
    assert.ok(stored.n >= 28);
    const inst = await call("POST", `/v1/agents/${leader.agentId}/policies/install`, { versionId: r.json.versionA }, leader.token);
    assert.equal(inst.status, 200);
    assert.equal(inst.json.activeVersionId, r.json.versionA);
  });

  it("rejects missing prompts and foreign heroes", async () => {
    const thin = await call("POST", "/v1/lab/ab", { agentId: leader.agentId, promptA: PROMPT_A }, leader.token);
    assert.equal(thin.status, 400);
    const alien = await call("POST", "/v1/lab/ab", { agentId: "nope", promptA: PROMPT_A, promptB: PROMPT_B }, leader.token);
    assert.equal(alien.status, 404);
  });
});

describe("long briefs", () => {
  const PARAGRAPH = [
    "My robot is a patient ambusher. It holds the center early and saves energy for the late fight.",
    "When the foe closes under six meters it dashes sideways and fires on the move.",
    "It keeps range whenever cover stands near, hiding behind it to dodge incoming fire.",
    "Below a quarter of health it retreats, conserves what energy remains, and only peeks out to shoot.",
    "It never wastes ammunition at long range without a clear line, and it chases a weakened foe to finish the bout.",
  ].join(" ");
  let prompter;

  it("provisions a prompter", async () => {
    const s = await call("POST", "/v1/auth/session", { handle: "paragrapher" });
    const g = await call("POST", "/v1/agents", {}, s.json.token);
    prompter = { token: s.json.token, agentId: g.json.agentId };
    assert.ok(prompter.agentId);
  });

  it("compiles a paragraph brief", async () => {
    const r = await call("POST", `/v1/agents/${prompter.agentId}/policies/compile`, { prompt: PARAGRAPH }, prompter.token);
    assert.equal(r.status, 201);
    assert.ok(r.json.versionId);
  });

  it("compiles exactly at the cap and rejects past it", async () => {
    const at = await call("POST", `/v1/agents/${prompter.agentId}/policies/compile`, { prompt: "x".repeat(2000) }, prompter.token);
    assert.equal(at.status, 201);
    const over = await call("POST", `/v1/agents/${prompter.agentId}/policies/compile`, { prompt: "x".repeat(2001) }, prompter.token);
    assert.equal(over.status, 400);
    assert.match(over.json.error, /under 2000/);
  });

  it("runs the lab on paragraph briefs", async () => {
    const r = await call("POST", "/v1/lab/ab", {
      agentId: prompter.agentId, promptA: PARAGRAPH, promptB: "Rush them down up close.", bouts: 4,
    }, prompter.token);
    assert.equal(r.status, 201);
    assert.match(r.json.verdict, /sample too small/);
    const over = await call("POST", "/v1/lab/ab", {
      agentId: prompter.agentId, promptA: "x".repeat(2001), promptB: "ok", bouts: 4,
    }, prompter.token);
    assert.equal(over.status, 422);
  });
});

describe("battle analysis", () => {
  it("explains a stored bout with its own numbers", async () => {
    const t = await call("POST", "/v1/matches/training", { versionId: "v-missing", seed: "x" }, leader.token);
    assert.equal(t.status, 404);
    const me = await call("GET", "/v1/me", null, leader.token);
    const v = me.json.agent.active_version_id;
    const bout = await call("POST", "/v1/matches/training", { versionId: v, seed: "why-1" }, leader.token);
    assert.equal(bout.status, 201);
    const r = await call("POST", `/v1/battles/${bout.json.matchId}/analysis`, {}, leader.token);
    assert.equal(r.status, 200);
    assert.equal(r.json.winner, bout.json.winner);
    assert.equal(r.json.checksum, bout.json.checksum);
    assert.ok(r.json.explanation.text.includes(bout.json.winner));
    assert.ok(r.json.explanation.text.includes(bout.json.checksum));
    assert.equal(r.json.explanation.grounded, true);
  });

  it("404s unknown bouts", async () => {
    const r = await call("POST", "/v1/battles/ghost/analysis", {}, leader.token);
    assert.equal(r.status, 404);
  });
});
