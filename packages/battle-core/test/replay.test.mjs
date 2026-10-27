import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BENCH_POLICY, buildReplay, fightPolicies } from "../src/index.ts";

const RUSH = {
  schemaVersion: 1,
  agentVersionId: "v-rush",
  dna: { aggression: 80, evasion: 40, preferredDistance: 25, energyConservation: 50 },
  rules: [
    { id: "close-fire", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
    { id: "far-push", when: { operand: "distFoe", op: "gte", value: 6 }, move: "APPROACH" },
  ],
};

describe("replay snapshots", () => {
  it("samples deterministic frames plus hit events", () => {
    const r1 = buildReplay(RUSH, BENCH_POLICY, "replay-1");
    const r2 = buildReplay(RUSH, BENCH_POLICY, "replay-1");
    assert.deepEqual(r1, r2);
    assert.ok(r1.frames.length > 10);
    assert.equal(r1.frames[0].t, 0);
    const f = r1.frames[0];
    assert.ok(typeof f.ax === "number" && typeof f.bhp === "number");
    for (const e of r1.events) {
      assert.ok(e.t >= 0 && (e.type === "hit" || e.type === "ko"));
    }
    const fight = fightPolicies(RUSH, BENCH_POLICY, "replay-1");
    assert.equal(r1.checksum, fight.checksum);
    assert.equal(r1.winner, fight.winner);
    assert.equal(r1.ticks, fight.ticks);
  });

  it("matches checksums across 100 seeds", () => {
    for (let i = 0; i < 100; i += 1) {
      const seed = `sweep-${i}`;
      const r = buildReplay(RUSH, BENCH_POLICY, seed);
      const fight = fightPolicies(RUSH, BENCH_POLICY, seed);
      assert.equal(r.checksum, fight.checksum);
    }
  });
});
