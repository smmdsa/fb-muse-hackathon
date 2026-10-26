---
id: TASK-0006
title: AP update plus tiers plus ledger
work: M
eye: NONE
owner: agent
---

# TASK-0006 — AP update plus tiers plus ledger

## Why

GDD section 6 fixes the AP math. The package makes the math runnable and testable.

## What to do

1. Write types, rating core, and tier lookup in `packages/ranking/src/`.
2. Write formula and tier tests in `packages/ranking/test/`.
3. Run `pnpm test` in the package and record the result.

## Done when

- Equal ratings move +20 and -20 exactly once.
- A 200 gap moves +12 for the favorite and +28 for the underdog.
- Draws, floor clip, duplicate match, and self-match behave per GDD.
- Tier edges map, with SINGULARITY at 1200 and no division.

## Not covered

Matchmaking and leases stay out of this task.

## Notes

- 2026-10-26 start: sprint-003 opened with rating only.
- 2026-10-26 close: 29 tests pass via pnpm (9 formula, 20 tiers). Fixed negative-zero draw delta. Full repo suite holds 50 green.
