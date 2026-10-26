---
id: epic-06
title: Mock economy
work: S
eye: NONE
---

# epic-06 — Mock economy

## Goal

AC and RP move through one idempotent ledger. Real money stays locked off.

## The measurement this epic stands on

`pnpm test` in `packages/economy` passes on 2026-10-26.

## Technical sheet

| component | file | what changes |
|---|---|---|
| ledger | `packages/economy/src/ledger.ts` | Wallets, idempotency, caps |
| shop | `packages/economy/src/shop.ts` | Catalog, mock purchase |

## Board

The tree computes the board. This sheet holds no progress.

## Verdicts

None yet.

## Out of scope

Billing, trade, and loot stay out of this epic. They stay out of the product until legal review.
