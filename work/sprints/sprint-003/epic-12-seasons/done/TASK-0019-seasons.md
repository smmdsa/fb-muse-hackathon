---
id: TASK-0019
title: Archive plus reset on rollover
work: S
eye: NONE
owner: agent
---

# TASK-0019 — Archive plus reset on rollover

## Why

GDD runs seasons of 28 to 90 days with a soft reset. The function must be exact.

## What to do

1. Write the rollover in `packages/seasons/src/`.
2. Write archive and reset tests in `packages/seasons/test/`.
3. Run `pnpm test` in the package and record the result.

## Done when

- The archive keeps final order with ranks frozen.
- Fresh states reset rating, AP, placement, and badge.
- History never mutates a closed season.

## Not covered

Scheduling and announcements stay out of this task.

## Notes

- 2026-10-26 start: epic-12 opened under sprint-003.
- 2026-10-26 close: 4 tests pass via pnpm on the first run. Full repo suite holds 123 green.
