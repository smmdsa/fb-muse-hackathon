// Benchmark: sim throughput plus a determinism gate. Run with pnpm bench.
import { compileAndPublish, createAgent, installVersion, openStore, runCasual } from "../apps/api/src/index.ts";
import { compileMock } from "../packages/ai-provider/src/index.ts";
import {
  checksum,
  createBattle,
  DEFAULT_BATTLE,
  drive,
  stepBattle,
} from "../packages/battle-core/src/index.ts";

const FIGHTS = Number(process.argv[2] || 20);

const fail = (msg) => {
  console.error(`bench error: ${msg}. Fix the input and run again.`);
  process.exit(1);
};

const a = await compileMock({ prompt: "rush them down up close", agentVersionId: "bench-a-v1" });
const b = await compileMock({ prompt: "evade and stay safe far away", agentVersionId: "bench-b-v1" });
if (!a.policy || !b.policy) fail("a draft came back invalid");

const runFight = (seed) => {
  const cfg = { ...DEFAULT_BATTLE, seed };
  let state = createBattle(cfg);
  let guard = 0;
  while (!state.over && guard < cfg.world.maxTicks) {
    state = stepBattle(
      state,
      { A: drive(state, a.policy, "A", cfg), B: drive(state, b.policy, "B", cfg) },
      cfg,
    );
    guard += 1;
  }
  if (!state.over) fail(`seed ${seed} never finished`);
  return { ticks: state.tick, sum: checksum(state), winner: state.winner };
};

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

const started = Date.now();
let totalTicks = 0;
let reference = "";
const fightMs = [];
for (let i = 0; i < FIGHTS; i += 1) {
  const seed = `bench-${String(i).padStart(3, "0")}`;
  const t0 = Date.now();
  const first = runFight(seed);
  fightMs.push(Date.now() - t0);
  const second = runFight(seed);
  if (first.sum !== second.sum) fail(`seed ${seed} is not deterministic`);
  if (i === 0) reference = `${seed}:${first.sum}:${first.winner}:${first.ticks}`;
  totalTicks += first.ticks;
}
const ms = Date.now() - started;
if (ms <= 0) fail("the clock did not move");
fightMs.sort((x, y) => x - y);

console.log(`fights: ${FIGHTS} (each run twice, checksums match)`);
console.log(`ticks: ${totalTicks} in ${ms} ms`);
console.log(`throughput: ${Math.round((totalTicks / ms) * 1000)} ticks/sec`);
console.log(`cost: ${(ms / FIGHTS).toFixed(2)} ms/fight`);
console.log(`latency: p50 ${pct(fightMs, 50)} ms, p95 ${pct(fightMs, 95)} ms, max ${fightMs[fightMs.length - 1]} ms`);
console.log(`compile: mock prompt ${a.promptTokens} tokens in ${a.latencyMs} ms (mock counts words, no model call)`);
console.log(`reference: ${reference}`);

// API settle loop: ten back-to-back casual fights on one store.
// Sequential is the floor; D1 serializes writes, so batches set the ceiling.
const api = openStore(":memory:");
api.db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run("l-bench", "bench", "t-bench");
const ab = await createAgent(api, {}, { leaderId: "l-bench", name: "bench", concept: "bench" });
const av = await compileAndPublish(api, {}, { agentId: ab.agentId, prompt: "rush them down up close" });
installVersion(api, { leaderId: "l-bench", agentId: ab.agentId, versionId: av.versionId });
const settleMs = [];
for (let i = 0; i < 10; i += 1) {
  const s0 = Date.now();
  const r = runCasual(api, { aVersionId: av.versionId, leaderId: "l-bench", bBot: "ladder", seed: `api-${i}` });
  settleMs.push(Date.now() - s0);
  if (!r.matchId) fail("a settlement posted nothing");
}
settleMs.sort((x, y) => x - y);
console.log(`settle: 10 fights, p50 ${pct(settleMs, 50)} ms, p95 ${pct(settleMs, 95)} ms, max ${settleMs[settleMs.length - 1]} ms`);
api.close();
