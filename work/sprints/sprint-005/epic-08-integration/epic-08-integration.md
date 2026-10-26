---
id: epic-08
title: Prompt to payout
work: M
eye: NONE
---

# epic-08 — Prompt to payout

## Goal

A text prompt fields a robot that fights, climbs, and earns.

## The measurement this epic stands on

`pnpm demo` prints a full loop receipt on 2026-10-26, and every suite passes.

## Technical sheet

| component | file | what changes |
|---|---|---|
| driver | `packages/battle-core/src/policy-driver.ts` | DNA intents steer the sim |
| demo | `scripts/e2e-demo.mjs` | Compile, fight, rank, pay |

## Board

The tree computes the board. This sheet holds no progress.

## Verdicts

None yet.

## Out of scope

Accounts, servers, and builder UI stay out of this epic.
