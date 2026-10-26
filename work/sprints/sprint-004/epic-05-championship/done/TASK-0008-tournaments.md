---
id: TASK-0008
title: Registration plus lock plus bracket
work: M
eye: NONE
owner: agent
---

# TASK-0008 — Registration plus lock plus bracket

## Why

GDD section 8 needs fair organizer events. The package makes them deterministic.

## What to do

1. Write types, registration, and bracket in `packages/tournaments/src/`.
2. Write rejection and reproducibility tests in `packages/tournaments/test/`.
3. Run `pnpm test` in the package and record the result.

## Done when

- Late, ineligible, and duplicate registrations each fail.
- Lock freezes versions; post-lock edits never enter the event.
- The same seed draws the same bracket, and the final runs best-of-3.

## Not covered

Prizes, admin UI, and engine hooks stay out of this task.

## Notes

- 2026-10-26 start: epic-05 opened under sprint-004.
- 2026-10-26 close: 12 tests pass via pnpm (6 registration, 6 bracket). Full repo suite holds 75 green.
