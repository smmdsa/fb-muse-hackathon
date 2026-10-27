---
id: TASK-0030
title: Matchmaking queue with ELO pairing and bot fallback
work: M
eye: NONE
owner: agent
---

# TASK-0030 — Matchmaking queue

## Why

Robots fight through matchmaking, never by player steering.
No human nearby must still mean a fight in 30 seconds.

## What to do

1. Add tickets plus bot presets at ladder bands.
2. Pair nearest-ELO published humans under the pair cap.
3. Settle casual with a same-band bot after 30s; ranked waits 10min.
4. Keep bot fights unrated with no AP move but honest AC pay.
5. Reuse the ranked settle path for humans on both stacks.

## Done when

- Queue unit tests prove bot fallback, ELO pairing, expiry, denial.
- Worker routes prove immediate settle, 400s, and privacy.
- Full suite green, dry-run clean.

## Not covered

Lazy settle on read; no cron. Ranked expiry spends the charge.

## Notes

- 2026-10-27 done: slice B committed as b79b7cd.
