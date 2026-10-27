---
id: TASK-0016
title: Auth plus agents plus publish
work: L
eye: NONE
owner: agent
---

# TASK-0016 — Auth plus agents plus publish

## Why

The API needs identity and versioned brains before any fight.

## What to do

1. Write the SQLite store and HTTP server in `apps/api/src/`.
2. Add demo key auth, one-agent rule, mock compile, and validated publish.
3. Prove with route tests on an ephemeral port and record the result.

## Done when

- A handle gets a token, creates one agent, and compiles plus publishes a version.
- A second agent for the same leader fails.
- An invalid draft never publishes.

## Not covered

Fights, leaderboard, and replay stay in TASK-0017.

## Notes

- 2026-10-26 start: epic-11 opened under sprint-006.
- 2026-10-26 close: 5 accounts tests pass. Route tests run in-memory because this shell denies listening sockets; the same router serves real HTTP in `dev`.
- Fixed: `startServer` rejected nothing on bind failure, which hung the suite. Listen errors now reject.
