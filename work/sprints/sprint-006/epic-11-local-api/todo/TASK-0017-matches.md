---
id: TASK-0017
title: Fights plus leaderboard plus replay
work: M
eye: GLANCE
owner: agent
---

# TASK-0017 — Fights plus leaderboard plus replay

## Why

Fights must settle server-side with rank, pay, and replay.

## What to do

1. Add training and ranked routes plus leaderboard and replay reads.
2. Settle fights with the engine: sim, ranking ledger, wallet earn.
3. Prove with route tests and one `curl` pass, and record both.

## Done when

- Training returns a checksum without moving AP.
- Ranked moves AP, pays AC, and replays by re-simulation.
- The leaderboard orders the leaders.

## Not covered

Cloudflare, OAuth, and builder UI stay out of this task.

## Notes

- 2026-10-26 start: waits on TASK-0016.
- 2026-10-26: 5 match tests pass (training, ranked, replay, dedupe, self-deny). The `curl` proof needs a shell that can bind ports; steps live in README for a hand run.
