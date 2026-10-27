---
id: TASK-0014
title: Opponent picker with pair caps
work: M
eye: NONE
owner: agent
---

# TASK-0014 — Opponent picker with pair caps

## Why

GDD section 7 demands server-owned opponents and anti-farming caps.

## What to do

1. Write eligibility, pair history, and nearest-rating pick in `packages/matchmaker/src/`.
2. Write exclusion, cap, and determinism tests in `packages/matchmaker/test/`.
3. Run `pnpm test` in the package and record the result.

## Done when

- Self, expired, unpublished, and opted-out leaders never get picked.
- A third meeting inside the window is denied, and opens after it.
- The nearest rating wins, with a deterministic tie-break.
- An empty pool returns null.

## Not covered

Live scheduling and rated defense accounting stay out of this task.

## Notes

- 2026-10-26 start: epic-09 opened under sprint-003.
- 2026-10-26 close: 6 tests pass via pnpm on the first run. Full repo suite holds 101 green.
