// Remote seed helper. Compiles two prompts, fights once, and prints the
// SQL that stores the finished match in D1. Pipe the output to a .sql file,
// run it with `wrangler d1 execute DB --remote --file=...`, then delete it.

import { compileMock } from "../packages/ai-provider/src/index.ts";
import {
  checksum,
  createBattle,
  DEFAULT_BATTLE,
  drive,
  stepBattle,
} from "../packages/battle-core/src/index.ts";

const promptA = process.argv[2] || "rush them down up close";
const promptB = process.argv[3] || "evade and stay far away";
const seed = process.argv[4] || "remote-seed-1";
const tag = process.argv[5] || "r1";

const fail = (msg) => {
  console.error(`seed-remote error: ${msg}. Fix the input and run again.`);
  process.exit(1);
};

const a = await compileMock({ prompt: promptA, agentVersionId: `${tag}-a-v1` });
const b = await compileMock({ prompt: promptB, agentVersionId: `${tag}-b-v1` });
if (!a.policy || !b.policy) fail("a draft came back invalid");

const cfg = { ...DEFAULT_BATTLE, seed };
let state = createBattle(cfg);
let guard = 0;
while (!state.over && guard < cfg.world.maxTicks) {
  state = stepBattle(state, { A: drive(state, a.policy, "A", cfg), B: drive(state, b.policy, "B", cfg) }, cfg);
  guard += 1;
}
if (!state.over) fail("the fight never finished");

const sum = checksum(state);
const winner = state.winner ?? "DRAW";
const esc = (obj) => JSON.stringify(obj).replace(/'/g, "''");

console.log(`INSERT INTO leaders (id, handle, token, rating_milli, ap, placement, placed, ac, rp) VALUES ('leader-${tag}-a', 'remote-${tag}-a', 'token-${tag}-a', 1020000, 520, 5, 1, 25, 100);`);
console.log(`INSERT INTO leaders (id, handle, token, rating_milli, ap, placement, placed, ac, rp) VALUES ('leader-${tag}-b', 'remote-${tag}-b', 'token-${tag}-b', 980000, 480, 5, 1, 10, 100);`);
console.log(`INSERT INTO agents (id, leader_id, active_version_id) VALUES ('agent-${tag}-a', 'leader-${tag}-a', '${tag}-a-v1');`);
console.log(`INSERT INTO agents (id, leader_id, active_version_id) VALUES ('agent-${tag}-b', 'leader-${tag}-b', '${tag}-b-v1');`);
console.log(`INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES ('${tag}-a-v1', 'agent-${tag}-a', '${esc(a.policy)}', 'remote', 0);`);
console.log(`INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES ('${tag}-b-v1', 'agent-${tag}-b', '${esc(b.policy)}', 'remote', 0);`);
console.log(`INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, delta_a, delta_b, created_at) VALUES ('match-${tag}', '${seed}', '${tag}-a-v1', '${tag}-b-v1', '${winner}', ${state.tick}, '${sum}', 1, 0, 0, 0);`);
console.error(`ready: winner ${winner}, ${state.tick} ticks, checksum ${sum}`);
