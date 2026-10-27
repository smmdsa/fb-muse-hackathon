---
id: epic-12
title: Season rollover
work: S
eye: NONE
---

# epic-12 — Season rollover

## Goal

A season closes with an archived board, and every leader restarts clean.

## The measurement this epic stands on

`pnpm test` in `packages/seasons` passes on 2026-10-26.

## Technical sheet

| component | file | what changes |
|---|---|---|
| rollover | `packages/seasons/src/rollover.ts` | Archive plus reset |

## Board

The tree computes the board. This sheet holds no progress.

## Verdicts

None yet.

## Out of scope

Scheduling and announcements stay out of this epic.
