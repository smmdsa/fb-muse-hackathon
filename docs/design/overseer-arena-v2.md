# Arena MOBA v2: The Overseer

New matches store `mode = moba-v2` and run `ARENA_MOBA`; historical `moba` rows retain `DEFAULT_MOBA` and their original tower positions. The public match type remains `moba` and replay includes rulesetVersion and authoritative structurePositions. Both simulation paths must remain available for replay compatibility. No database migration is needed for the existing TEXT `mode` column.

## Arena

The central lane is 48 × 16. On side A, T1 is x19, T2 x12, inhibitor x8.5, nexus turrets x5 and nexus x2. Side B is mirrored across x24. Enemy outer towers are 10 world units apart, with a 4.8-unit attack radius; interior towers overlap by design. The viewer highlights the danger ring only when a living enemy robot is in range, based on replayed positions. Visual indicators do not affect simulation.

## Overseer

Neutral guardian at (24,3). It first spawns at 6:00 (tick 10800 at 30Hz), has 500 HP, and respawns 3:00 (5400 ticks) after death. Every second it strikes living, unprotected robots within 5 units for 20 raw damage, subject to armor. On the killing hit, the credited side receives +20% robot attack damage for 1:30 (2700 ticks). Values are provisional and require balance/playtesting. Old ruleset has no Overseer. If the match ends before 6:00, it never spawns.

The chip can use `overseerAlive`, `overseerHpPct`, `overseerDist`, `overseerSpawnSeconds`, `ownOverseerBuffSeconds`, `foeOverseerBuffSeconds`; move `CONTEST_OVERSEER` and target `OVERSEER`. These are unavailable in the old ruleset. Default chips do not automatically decide to fight the guardian; a chip must instruct it. Simulator logs spawn, hits and defeat; replay frames include guardian health, timing and buff deadlines. Visuals include a pit, health, respawn timer, hit tracer and buff ring/timer.

The side landing the killing-tick hit receives the buff. If both sides land hits during that same tick, both receive the buff to avoid side-order bias. A buff applies to robot attacks, not minions. The initial mechanics are not a substitute for tuning, actual playtesting, collision and pathing QA, or a real Muse API evaluation.

New ruleset calculates the last-hit threshold from actual raw minion damage; the legacy ruleset retains its prior prediction to avoid changing historic outcomes. User-facing numbers describe v2.
