---
id: epic-13
title: Worker write routes
work: L
eye: NONE
---

# epic-13 — Worker write routes

## Goal

The deployed worker serves the full API on D1. The Node server stays for local dev.

## The measurement this epic stands on

`pnpm test` in `apps/api` passes with write-route tests on the D1 shim.

## Technical sheet

| component | file | what changes |
|---|---|---|
| fight | `packages/battle-core/src/policy-driver.ts` | Shared fightPolicies |
| writes | `apps/api/src/worker.ts` | Auth, publish, training, ranked on D1 |

## Board

The tree computes the board. This sheet holds no progress.

## Verdicts

None yet.

## Out of scope

OAuth and builder UI stay out of this epic.
