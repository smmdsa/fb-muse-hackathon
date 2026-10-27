---
id: epic-10
title: Season standings
work: S
eye: NONE
---

# epic-10 — Season standings

## Goal

One board orders every placed leader by AP with deterministic breaks.

## The measurement this epic stands on

`pnpm test` in `packages/leaderboard` passes on 2026-10-26.

## Technical sheet

| component | file | what changes |
|---|---|---|
| board | `packages/leaderboard/src/board.ts` | Sort, tie-break, top-N |

## Board

The tree computes the board. This sheet holds no progress.

## Verdicts

None yet.

## Out of scope

Live updates and public pages stay out of this epic.
