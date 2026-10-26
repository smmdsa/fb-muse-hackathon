# rules.md — S1 scope only

One line per GDD rule with a number or condition. Status set by reading the code on 2026-10-26.

## Arena

- Arena is 24 x 16 world units | when: every fight | ends: never | applies to: sim and viewer | built
- Tick rate is 30 Hz | when: every fight | ends: never | applies to: sim and viewer | built
- Fight cap is 90 s / 2700 ticks | when: every fight | ends: at cap | applies to: sim and viewer | built
- Agent radius is 0.35 | when: every fight | ends: never | applies to: sim and viewer | built
- Base speed is 4 units/s | when: every fight | ends: never | applies to: sim and viewer | built
- HP is 100 | when: every fight | ends: at 0, unit dies | applies to: sim and viewer | built
- Combat energy is 100, regen 8/s | when: every fight | ends: never | applies to: sim and viewer | built
- Gun deals 10 damage, max 2 shots/s | when: fire intent | ends: on hit or cover | applies to: sim and viewer | built
- Dash costs 25 energy, 3 s cooldown | when: dash intent | ends: after dash | applies to: sim | built
- Dash costs 25 energy, no cooldown | when: dash intent | ends: after dash | applies to: viewer | built (divergence, viewer has no cooldown)
- Shield costs 20 energy, 0.8 s active | when: shield intent | ends: after 0.8 s | applies to: sim | built
- Shield never triggers | when: every viewer fight | ends: never | applies to: viewer | missing (viewer policy never shields)
- 4 cover blocks sit mirrored | when: every fight | ends: never | applies to: sim and viewer | built
- Covers block shots with swept checks | when: every shot | ends: on block | applies to: sim and viewer | built
- Spawns sit mirrored at x=2 and x=22 | when: fight start | ends: at first move | applies to: sim | built
- Seed picks straight or mirrored spawns | when: viewer start | ends: at reset | applies to: viewer | built
- Units move and aim in the same tick | when: every tick | ends: never | applies to: sim and viewer | built
- Timeout winner uses damage, then control, then HP | when: tick 2700 | ends: at decision | applies to: sim | built
- Timeout winner uses HP only | when: tick 2700 | ends: at decision | applies to: viewer | built (divergence, viewer ignores control time)
- Same seed and versions give the same checksum | when: every sim fight | ends: never | applies to: sim | built (100-repeat test)
- SHADOW.EXE runs 35/80/65/70 | when: every sim fight | ends: never | applies to: sim and viewer | built
- BREAKER.01 runs 80/30/20/35 | when: every sim fight | ends: never | applies to: sim and viewer | built
- BENCH policy runs mid values | when: bench fights | ends: never | applies to: sim | built
- BENCH policy is absent | when: every viewer fight | ends: never | applies to: viewer | missing
- Control zone is 4x4 at center | when: every fight | ends: never | applies to: sim and viewer maps | built
- Control time accrues on presence | when: inside zone | ends: on exit | applies to: sim | built
- Control time is ignored | when: inside zone | ends: never | applies to: viewer | missing
- No brain state persists across loads | when: fresh load | ends: never | applies to: viewer | built (no storage calls in code)
- One display face for titles and numbers | when: every screen | ends: never | applies to: viewer | built (Chakra Petch with system fallback)
- One accent on the action plus SHADOW | when: every screen | ends: never | applies to: viewer | built (cyan only)
- End screen sits over the scene with stats | when: fight ends | ends: at restart | applies to: viewer | built
- Every hit draws a spark, a number, and a bar flash | when: a shot lands | ends: after fade | applies to: viewer | built
- Reduced motion slows the demo pace | when: OS asks | ends: never | applies to: viewer | built (6 ticks/s, sim math unchanged)
