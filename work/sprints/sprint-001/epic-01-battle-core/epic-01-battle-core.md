---
id: epic-01
title: Deterministic battle-core
work: M
eye: GLANCE
---

# epic-01 — Deterministic battle-core

## Goal

The sim produces the same checksum for the same seed in 100 repeats.

## The measurement this epic stands on

`node --test` passes 7 tests on 2026-10-26, plus a 1000-fight bench with legal state.

## Technical sheet

| component | file | what changes |
|---|---|---|
| sim | `packages/battle-core/src/simulation.ts` | Tick step, scoring, checksum |
| policies | `packages/battle-core/src/policies.ts` | SHADOW, BREAKER, BENCH |
| tests | `packages/battle-core/test/` | Determinism and mirror suites |

## Board

The tree computes the board. This sheet holds no progress.

## Verdicts

None yet.

## Out of scope

Ranked AP, AutoBattle, championships, and shop stay out of this epic.
