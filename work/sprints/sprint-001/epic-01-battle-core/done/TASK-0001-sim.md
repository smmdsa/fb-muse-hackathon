---
id: TASK-0001
title: Deterministic sim plus policies plus tests
work: M
eye: NONE
owner: agent
---

# TASK-0001 — Deterministic sim plus policies plus tests

## Why

GDD section 3 sets a 30 Hz deterministic arena. The sim is the base for all later sprints.

## What to do

1. Write types, RNG, world, sim, and policies in `packages/battle-core/src/`.
2. Write determinism and mirror suites in `packages/battle-core/test/`.
3. Run `node --test` from the package folder and record the result.

## Done when

- Same seed gives the same checksum in 100 repeats.
- 1000 seeded fights finish with legal state and no NaN.
- Mirror checks pass for spawns and covers.

## Not covered

The browser viewer, ranked AP, and AutoBattle stay out of this task.

## Notes

- 2026-10-26 start: scaffolded `packages/battle-core` with 5 source files.
- 2026-10-26 close: 7 tests pass (3 determinism, 4 mirror). Build smoke gives checksum 5e04e942 at 300 ticks.
