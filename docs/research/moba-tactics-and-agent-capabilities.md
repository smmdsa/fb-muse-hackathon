# MOBA tactical model for Agent Wars

Status: research and proposed requirements, not implemented mechanics. Baseline `main` 291a0eb. Agent Wars is 1v1 on one lane, so League of Legends' team, jungle and multi-lane play must be adapted, not copied literally.

## Sources

- Riot, How to Play: https://www.leagueoflegends.com/es-mx/how-to-play/ — minions in front of towers, neutral monsters and Baron buff.
- Riot, patch 26.1: https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/ — current LoL timing differs from the Agent Wars simulation.
- League of Legends Wiki, turret targeting: https://wiki.leagueoflegends.com/en-us/Turrets — turret aggro can switch when a champion attacks another under tower; allied minions are not an unconditional safety guarantee.
- MID.GG, wave management: https://mid.gg/guides/wave-management — freeze, build a slow push, crash before a recall or objective; these are contextual tactics, not universal rules.

## Decision situations to express as chip policies

| Situation | Player-relevant evidence | Possible instructions and tradeoffs |
|---|---|---|
| Trade versus hero | distance, sight, own/foe health, cooldowns, nearby waves, turret threat | poke or commit when favorable; retreat if outnumbered. Damage drawn from minions and tower may reverse advantage. |
| Last hit or shove | individual minion health, attack damage, travel time, ally/enemy wave strength and next wave | last-hit only for gold and wave control; clear quickly when immediate pressure is needed. |
| Freeze or slow push | where the waves meet, count and health of each side, reinforcement arrival | hold near own tower without letting it hit the tower, or build a larger allied wave. Requires precise targeting, waiting and movement; a fixed nearby count is insufficient. |
| Siege | tower attack range, current target, allied minions inside its range, enemy champion | wait outside range until an allied unit draws aggro; enter to attack structure; leave if aggro switches or cover dies. |
| Return to base | health, gold, healing, wave state, time to next wave, threats to own tower | leave after a crash if safe, or emergency retreat despite lost farm. Current RETREAT walks home; it is not a channelled recall. |
| Defense | enemy wave, distance and threat to own structures | clear wave or defend tower; leaving for a neutral objective may cost a structure. |
| Neutral objective | monster health, position, spawn/death timers, expected damage, rival state, wave pressure | attack, contest, steal the last hit, abandon, or use its pressure to siege. None of this exists in baseline. |

## Current game gaps

`policy-driver.ts` supports PUSH, FARM, DEFEND, RETREAT, a few scalar observations and hardcoded automatic targeting. It does not expose turret current target or danger, individual minion state, wave front and incoming timing, neutral monsters or true last-seen memory. `foeLastSeenAge` is always zero. The simulator owns turret targeting and physics; the chip needs legal, explicit instructions and observables, not unrestricted executable code. The separate PR #30 adds optional target classes but is not merged into main at time of writing.

## Proposed original neutral objective: THE OVERSEER

Prototype a neutral mechanical sentinel in a symmetric side pit connected to the lane. Both sides can damage it; last eligible damage awards a short-lived siege boost to the killer's side and nearby allied minions. Attacking it costs health and reveals commitment. Telegraph spawn and respawn timers; if both die simultaneously define deterministic ordering. Place its location and timing to create a choice with defending and farming, and test both sides on mirrored seeds. Exact stats and timings are hypotheses for playtesting, not adopted LoL values.

## Implementation order and acceptance criteria

1. Publish a versioned observation/action contract, including units, missing/hidden values and first-match semantics. Extend only alongside real engine behavior.
2. Implement reliable tower threat and aggro observations; add WAIT and target/last-hit intent. Scenario tests: waits outside range, attacks behind allied minions, retreats if the tower switches targets, handles no minions and preserves mirrored outcomes.
3. Add wave position, ally/enemy counts and total health, minion killability, time to reinforcements and own-tower threat. Prove last-hit, freeze and push behavior on seeded scenarios; measure when they fail instead of claiming perfect LoL emulation.
4. Add base/retreat rules, health thresholds and clear healing behavior. Test emergency retreat versus planned crash and prevent oscillation with explicit state/hysteresis.
5. Add the neutral objective as a versioned, deterministic simulation entity: spawn, combat, targeting, damage credit, buff duration, respawn, replay/log, mirrored fairness and spectator visibility.
6. Let Muse compile these decisions only after the corresponding observations/actions exist. Report unrepresentable requests and test with real model outputs, a labeled multilingual benchmark, and replayed end-to-end scenarios. No model calls during simulation ticks.

Changing existing simulation behavior may invalidate historical checksums: preserve old ruleset and replay version before enabling new mechanics for new matches.
