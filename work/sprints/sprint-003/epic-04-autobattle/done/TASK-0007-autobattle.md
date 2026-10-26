---
id: TASK-0007
title: Lease plus stamina plus defense quota
work: M
eye: NONE
owner: agent
---

# TASK-0007 — Lease plus stamina plus defense quota

## Why

GDD section 7 needs human control over offline fights. The machine enforces it.

## What to do

1. Write the state machine with an injected clock in `packages/autobattle/src/`.
2. Write transition tests in `packages/autobattle/test/`.
3. Run `pnpm test` in the package and record the result.

## Done when

- Lease expiry blocks new matches at 24 hours, and reads never renew it.
- Empty stamina blocks owner matches, and regen refills 1 per 2 hours.
- No resume happens after expiry, even with full stamina.
- The 4th defense in 24 hours counts as unranked.
- An in-progress match finishes, then expiry applies.

## Not covered

Matchmaking and rated defense accounting stay out of this task.

## Notes

- 2026-10-26 start: epic-04 opened under sprint-003.
- 2026-10-26 close: 13 tests pass via pnpm (4 lease, 4 stamina, 5 defense and flags). Fixed one test bug twice: the rolling window and the expired lease both behaved per spec; the test setup was wrong. Full repo suite holds 63 green.
