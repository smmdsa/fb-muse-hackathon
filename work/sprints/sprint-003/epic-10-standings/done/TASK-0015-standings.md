---
id: TASK-0015
title: Standings board with tie-breaks
work: S
eye: NONE
owner: agent
---

# TASK-0015 — Standings board with tie-breaks

## Why

GDD sections 6 and 9 need a visible ladder with audited order.

## What to do

1. Write the standings builder in `packages/leaderboard/src/`.
2. Write order, tie, and placement tests in `packages/leaderboard/test/`.
3. Run `pnpm test` in the package and record the result.

## Done when

- AP sorts down, internal rating breaks AP ties, id breaks the rest.
- Provisional leaders stay off the board.
- Top-N cuts cleanly without shifting ranks.

## Not covered

Live updates and public pages stay out of this task.

## Notes

- 2026-10-26 start: epic-10 opened under sprint-003.
- 2026-10-26 close: 4 tests pass via pnpm on the first run. Full repo suite holds 105 green.
