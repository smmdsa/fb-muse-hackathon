---
id: TASK-0029
title: Energy budget on every manual match
work: S
eye: NONE
owner: agent
---

# TASK-0029 — Energy budget

## Why

No energy means no match. The machine already defined the budget;
no route spent it.

## What to do

1. Add `spendManualMatch` to the machine: stamina only, no lease gates.
2. Persist the machine per leader and surface it on `/v1/me` plus dashboard.
3. Spend on ranked and queue requests. Training stays free.
4. Dedup and validation run before the spend.

## Done when

- Ranked at zero energy answers 409 `energy empty`.
- Training never spends. Replays never double-spend.
- autobattle 16/16, API green, dry-run clean.

## Not covered

AutoBattle leases stay manual and later. No refund on ranked expiry.

## Notes

- 2026-10-27 done: slice A committed as 26d71fd.
