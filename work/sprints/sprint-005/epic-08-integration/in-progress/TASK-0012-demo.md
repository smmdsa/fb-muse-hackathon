---
id: TASK-0012
title: End-to-end demo script
work: S
eye: GLANCE
owner: agent
---

# TASK-0012 — End-to-end demo script

## Why

One command must prove the loop: prompt, compile, fight, rank, pay.

## What to do

1. Write `scripts/e2e-demo.mjs` and a root `pnpm demo` entry.
2. Run it twice with different prompts and record both receipts.
3. Update the implementation status with the milestone.

## Done when

- `pnpm demo "some prompt"` prints traits, rules, winner, AP moves, and AC payout.
- The user runs it by hand and confirms the receipt.

## Not covered

Accounts, servers, and builder UI stay out of this task.

## Notes

- 2026-10-26 start: waits on TASK-0011.
- 2026-10-26 runs: `pnpm demo` prints B-wins receipt (checksum 280f44aa). Second run with new prompts prints A-wins receipt (checksum 913f9af6). User hand run is pending.
