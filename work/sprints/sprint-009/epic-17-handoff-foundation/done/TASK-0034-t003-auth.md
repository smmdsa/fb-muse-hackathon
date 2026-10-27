---
id: TASK-0034
title: T003 secure auth, crypto ids, ownership, rate limits
work: M
eye: NONE
owner: agent
---

# TASK-0034 — T003 (handoff)

## What changed

- `mintId` now carries 64 crypto-random bits (`getRandomValues`, no import
  needed on node or workers). `newToken` mints 128-bit opaque tokens.
  Demo prefix stays so nobody mistakes them for real credentials.
- Ownership enforced on training (both stacks, 404 otherwise); compile
  already guarded. Cross-leader compile/train tests lock it.
- Sliding-window throttles (memory-only, documented): auth 10/min per
  handle, compile 6/min per leader, queue 6/min per leader, training
  20/min per leader. Unit plus route tests.
- InnerHTML audit: only two static-string uses, no user data.

## Evidence

- New `ids.test.mjs` (uniqueness, entropy format, window behavior).
- Full suite green. Worker dry-run clean.

## Done when

- Committed. Next: T004 atomic settlement.
