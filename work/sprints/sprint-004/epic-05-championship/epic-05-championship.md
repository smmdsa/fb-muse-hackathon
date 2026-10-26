---
id: epic-05
title: Championship bracket
work: M
eye: NONE
---

# epic-05 — Championship bracket

## Goal

Eight registered leaders play one reproducible bracket on locked versions.

## The measurement this epic stands on

`pnpm test` in `packages/tournaments` passes on 2026-10-26.

## Technical sheet

| component | file | what changes |
|---|---|---|
| registry | `packages/tournaments/src/registration.ts` | Cutoff, eligibility, dupes |
| bracket | `packages/tournaments/src/bracket.ts` | Seeded draw, rounds, final |

## Board

The tree computes the board. This sheet holds no progress.

## Verdicts

None yet.

## Out of scope

Prizes, admin UI, and engine hooks stay out of this epic.
