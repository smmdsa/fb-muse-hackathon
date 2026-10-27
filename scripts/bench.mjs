// Benchmark: sim throughput plus a determinism gate. Run with pnpm bench.
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

const started = Date.now();
let totalTicks = 0;
let reference = "";
for (let i = 0; i < FIGHTS; i += 1) {
  const seed = `bench-${String(i).padStart(3, "0")}`;
  const first = runFight(seed);
  const second = runFight(seed);
  if (first.sum !== second.sum) fail(`seed ${seed} is not deterministic`);
  if (i === 0) reference = `${seed}:${first.sum}:${first.winner}:${first.ticks}`;
  totalTicks += first.ticks;
}
const ms = Date.now() - started;
if (ms <= 0) fail("the clock did not move");

console.log(`fights: ${FIGHTS} (each run twice, checksums match)`);
console.log(`ticks: ${totalTicks} in ${ms} ms`);
console.log(`throughput: ${Math.round((totalTicks / ms) * 1000)} ticks/sec`);
console.log(`cost: ${(ms / FIGHTS).toFixed(2)} ms/fight`);
console.log(`reference: ${reference}`);
