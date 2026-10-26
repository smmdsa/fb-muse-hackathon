---
id: TASK-0009
title: Wallet ledger plus mock shop
work: S
eye: NONE
owner: agent
---

# TASK-0009 — Wallet ledger plus mock shop

## Why

GDD section 9 needs server-side AC and RP with no real billing in the milestone.

## What to do

1. Write wallet, ledger, and shop in `packages/economy/src/`.
2. Write earn, purchase, and lock tests in `packages/economy/test/`.
3. Run `pnpm test` in the package and record the result.

## Done when

- Earns credit 25 for a win and 10 for a loss, capped at 150 AC per day.
- No-contest and suspicious results credit zero.
- One idempotency key never charges twice, and poor wallets fail clean.
- Real-money purchase always throws.

## Not covered

Billing, trade, and loot stay out of this task.

## Notes

- 2026-10-26 start: epic-06 opened under sprint-004.
- 2026-10-26 close: 10 tests pass via pnpm (6 ledger, 4 shop). Full repo suite holds 85 green.
