---
id: epic-02
title: Builder contracts
work: M
eye: NONE
---

# epic-02 — Builder contracts

## Goal

Any policy draft passes one strict validator before the sim or UI ever sees it.

## The measurement this epic stands on

`node --test` in `packages/behavior-dna` passes on 2026-10-26.

## Technical sheet

| component | file | what changes |
|---|---|---|
| types | `packages/behavior-dna/src/types.ts` | Policy, rule, predicate types |
| validator | `packages/behavior-dna/src/validate.ts` | Allowlist, depth, node, bound checks |
| evaluator | `packages/behavior-dna/src/evaluate.ts` | First-match intents plus fallback |

## Board

The tree computes the board. This sheet holds no progress.

## Verdicts

None yet.

## Out of scope

AI compile, accounts, and publish flow stay out of this epic.
