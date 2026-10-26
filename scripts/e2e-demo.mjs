// End-to-end demo: prompt, compile, fight, rank, pay. Run with pnpm demo.

import { compileMock } from "../packages/ai-provider/src/index.ts";
import {
  checksum,
  createBattle,
  DEFAULT_BATTLE,
  drive,
  stepBattle,
} from "../packages/battle-core/src/index.ts";
import { applyRanked, createLedger } from "../packages/ranking/src/index.ts";
import { createWallet, earnAc } from "../packages/economy/src/index.ts";

const promptA = process.argv[2] || "rush them down up close";
const promptB = process.argv[3] || "evade and stay safe far away";
const seed = process.argv[4] || "demo-001";

const fail = (msg) => {
  console.error(`demo error: ${msg}. Fix the input and run again.`);
  process.exit(1);
};

const a = await compileMock({ prompt: promptA, agentVersionId: "demo-a-v1" });
const b = await compileMock({ prompt: promptB, agentVersionId: "demo-b-v1" });
if (!a.policy || !b.policy) fail("a draft came back invalid");
if (!a.isMock || !b.isMock) fail("a result hides its mock source");

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
if (!state.over) fail("the fight never finished");

const ledger = createLedger("demo-s1");
const winner = state.winner === "DRAW" ? "DRAW" : state.winner;
const ranked = applyRanked(ledger, {
  matchId: `demo-${seed}`,
  leaderA: "demo-leader-a",
  leaderB: "demo-leader-b",
  winner,
  rated: true,
});

const walletA = createWallet("demo-leader-a");
const walletB = createWallet("demo-leader-b");
const payA = earnAc(walletA, {
  key: `demo-${seed}-a`,
  kind: winner === "A" ? "win" : winner === "B" ? "loss" : "no-contest",
  suspicious: false,
  now: 0,
});
const payB = earnAc(walletB, {
  key: `demo-${seed}-b`,
  kind: winner === "B" ? "win" : winner === "A" ? "loss" : "no-contest",
  suspicious: false,
  now: 0,
});

const receipt = {
  seed,
  promptA,
  promptB,
  dnaA: a.policy.dna,
  dnaB: b.policy.dna,
  rulesA: a.policy.rules.map((r) => r.id),
  rulesB: b.policy.rules.map((r) => r.id),
  winner,
  ticks: state.tick,
  checksum: checksum(state),
  deltaA: ranked.deltaA,
  deltaB: ranked.deltaB,
  apA: ranked.apA,
  apB: ranked.apB,
  acA: walletA.ac,
  acB: walletB.ac,
  paidA: payA.credited,
  paidB: payB.credited,
};

console.log(`prompt A: "${promptA}" -> aggression ${receipt.dnaA.aggression}, rules ${receipt.rulesA.join(",")}`);
console.log(`prompt B: "${promptB}" -> evasion ${receipt.dnaB.evasion}, rules ${receipt.rulesB.join(",")}`);
console.log(`fight: ${receipt.winner} wins in ${receipt.ticks} ticks (checksum ${receipt.checksum})`);
console.log(`ranked: A ${receipt.deltaA >= 0 ? "+" : ""}${receipt.deltaA} -> ${receipt.apA} AP, B ${receipt.deltaB >= 0 ? "+" : ""}${receipt.deltaB} -> ${receipt.apB} AP`);
console.log(`payout: A +${receipt.paidA} AC (${receipt.acA}), B +${receipt.paidB} AC (${receipt.acB})`);
console.log(JSON.stringify(receipt));
