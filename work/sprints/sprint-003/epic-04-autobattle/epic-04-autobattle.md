---
id: epic-04
title: AutoBattle control
work: M
eye: NONE
---

# epic-04 — AutoBattle control

## Goal

Leases gate every offline fight. Stamina budgets owner-initiated matches. Quotas cap defense.

## The measurement this epic stands on

`pnpm test` in `packages/autobattle` passes on 2026-10-26.

## Technical sheet

| component | file | what changes |
|---|---|---|
| machine | `packages/autobattle/src/machine.ts` | States, lease, stamina, quotas |
| clock | injected `now` | Every test pins its own time |

## Board

The tree computes the board. This sheet holds no progress.

## Verdicts

None yet.

## Out of scope

Matchmaking and rated defense accounting stay out of this epic.
