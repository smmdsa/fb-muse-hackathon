import {
  checksum,
  createBattle,
  DEFAULT_BATTLE,
  stepBattle,
  dnaPolicy,
  SHADOW_DNA,
  BREAKER_DNA,
} from "../src/index.ts";

const CENTER = { x: 12, y: 8 };
const cfg = { ...DEFAULT_BATTLE, seed: "smoke" };
let s = createBattle(cfg);
for (let t = 0; t < 300; t += 1) {
  s = stepBattle(
    s,
    {
      A: dnaPolicy(s.agents.A, s.agents.B, s, SHADOW_DNA, CENTER),
      B: dnaPolicy(s.agents.B, s.agents.A, s, BREAKER_DNA, CENTER),
    },
    cfg,
  );
}
console.log(`build-check ticks=${s.tick} checksum=${checksum(s)}`);
if (!Number.isFinite(s.agents.A.pos.x)) {
  console.error("build-check error: NaN state, sim is broken");
  process.exit(1);
}
