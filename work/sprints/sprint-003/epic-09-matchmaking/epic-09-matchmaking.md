---
id: epic-09
title: Fair matchmaking
work: M
eye: NONE
---

# epic-09 — Fair matchmaking

## Goal

The server picks every opponent. No self-fights, no farming loops.

## The measurement this epic stands on

`pnpm test` in `packages/matchmaker` passes on 2026-10-26.

## Technical sheet

| component | file | what changes |
|---|---|---|
| picker | `packages/matchmaker/src/pick.ts` | Eligibility, pair caps, nearest rating |

## Board

The tree computes the board. This sheet holds no progress.

## Verdicts

None yet.

## Out of scope

Live scheduling and rated defense accounting stay out of this epic.
