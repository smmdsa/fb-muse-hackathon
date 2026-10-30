// E2E fixtures. Two brawler chips and one golden best-of-3 series.
// Seed e2e-gold-14 ends 0-2 by knockout and holds shots, skills,
// all three pickup kinds, and deep energy swings. Checksum pins it.

import { runCasual } from "../apps/api/src/flow.ts";

export const GOLDEN_SEED = "e2e-gold-14";
export const GOLDEN_CHECKSUM = "b1210d29";
export const GOLDEN_MATCH_ID = "e2e-golden-1";

export const POLICY_A = {
  schemaVersion: 2,
  agentVersionId: "e2e-gold-a",
  dna: { aggression: 80, evasion: 30, preferredDistance: 20, energyConservation: 35 },
  rules: [
    { id: "sk", when: { all: [{ operand: "skillReady", op: "eq", value: true }, { operand: "distFoe", op: "lt", value: 7 }] }, move: "APPROACH", fire: true, skill: true },
    { id: "grab", when: { operand: "pickupDist", op: "lt", value: 9 }, move: "COLLECT", fire: true },
    { id: "rush", when: { operand: "distFoe", op: "gte", value: 6 }, move: "APPROACH", fire: true },
    { id: "fight", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
  ],
};

export const POLICY_B = {
  schemaVersion: 2,
  agentVersionId: "e2e-gold-b",
  dna: { aggression: 65, evasion: 55, preferredDistance: 40, energyConservation: 50 },
  rules: [
    { id: "sk", when: { all: [{ operand: "skillReady", op: "eq", value: true }, { operand: "distFoe", op: "lt", value: 7 }] }, move: "KITE", fire: true, skill: true },
    { id: "grab", when: { operand: "pickupDist", op: "lt", value: 9 }, move: "COLLECT", fire: true },
    { id: "far", when: { operand: "distFoe", op: "gte", value: 6 }, move: "APPROACH", fire: true },
    { id: "near", when: { operand: "distFoe", op: "lt", value: 6 }, move: "STRAFE", fire: true },
  ],
};

const LEADERS = [
  { id: "e2e-alice", handle: "e2e-alice", token: "e2e-token-alice", ap: 500 },
  { id: "e2e-bob", handle: "e2e-bob", token: "e2e-token-bob", ap: 500 },
];

const AGENTS = [
  { id: "e2e-agent-a", leader: "e2e-alice", version: "e2e-va", name: "ALICE" },
  { id: "e2e-agent-b", leader: "e2e-bob", version: "e2e-vb", name: "BOB" },
];

// The seeder writes two leaders, agents, chips, and the golden match.
export function seedE2E(store) {
  for (const l of LEADERS) {
    store.db.prepare("INSERT INTO leaders (id, handle, token, ap) VALUES (?, ?, ?, ?)").run(l.id, l.handle, l.token, l.ap);
  }
  const policies = { "e2e-va": POLICY_A, "e2e-vb": POLICY_B };
  for (const a of AGENTS) {
    store.db.prepare("INSERT INTO agents (id, leader_id, active_version_id, name) VALUES (?, ?, ?, ?)").run(a.id, a.leader, a.version, a.name);
    store.db.prepare(
      "INSERT INTO versions (id, agent_id, policy_json, sha, created_at, provider, is_mock) VALUES (?, ?, ?, ?, ?, 'e2e', 1)",
    ).run(a.version, a.id, JSON.stringify(policies[a.version]), "e2e", Date.now());
  }
  const golden = runCasual(store, {
    aVersionId: "e2e-va",
    bVersionId: "e2e-vb",
    seed: GOLDEN_SEED,
    leaderId: "e2e-alice",
    key: GOLDEN_MATCH_ID,
    otherLeaderId: "e2e-bob",
  });
  if (golden.checksum !== GOLDEN_CHECKSUM) {
    throw new Error(`golden series moved: got ${golden.checksum}, want ${GOLDEN_CHECKSUM}`);
  }
  return {
    alice: { id: "e2e-alice", handle: "e2e-alice", token: "e2e-token-alice", versionId: "e2e-va" },
    bob: { id: "e2e-bob", handle: "e2e-bob", token: "e2e-token-bob", versionId: "e2e-vb" },
    matchId: golden.matchId,
  };
}
