---
id: epic-03
title: Ranked rating
work: M
eye: NONE
---

# epic-03 — Ranked rating

## Goal

One decisive 1v1 result moves both AP values by the same size in opposite signs.

## The measurement this epic stands on

`pnpm test` in `packages/ranking` passes on 2026-10-26.

## Technical sheet

| component | file | what changes |
|---|---|---|
| rating | `packages/ranking/src/rating.ts` | Elo core, clamp, floor, ledger |
| tiers | `packages/ranking/src/tiers.ts` | Tier and division lookup |

## Board

The tree computes the board. This sheet holds no progress.

## Verdicts

None yet.

## Out of scope

Matchmaking, leases, and championships stay out of this epic.
