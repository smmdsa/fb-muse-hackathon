---
id: sprint-001
title: S1 battle-core and demo viewer
starts: 2026-10-26
ends: 2026-11-02
---

# sprint-001 — S1 battle-core and demo viewer

## The one sentence

Deterministic arena fights run in Node and in a browser demo with tracked proof.

## Where this scope comes from

GDD sections 3, 13, and 18 in `docs/AGENT_WARS_GDD_v1.0.md`, dated 2026-10-26.

## Objectives, and how each one is checked

| # | objective | check |
|---|---|---|
| 1 | Deterministic 30 Hz sim with THE_FORGE map | `node --test` passes 7 tests |
| 2 | SHADOW, BREAKER, and BENCH policies | Policies run in all 1000 bench fights |
| 3 | Browser demo starts from a title and plays | Human presses Start and watches a fight |
| 4 | Work stays tracked in this tree | Board files exist for each task |

## Definition of done

- Every task with an eye has a verdict in the user's words.
- All checks in the table pass.

## What this sprint does NOT do

- No accounts, no ranked AP, no AutoBattle, no shop. S2 to S4 cover those.
