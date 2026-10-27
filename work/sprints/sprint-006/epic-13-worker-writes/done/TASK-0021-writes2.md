---
id: TASK-0021
title: Worker training and ranked routes
work: M
eye: NONE
owner: agent
---

# TASK-0021 — Worker training and ranked routes

## Why

Fights must settle on the deployed worker, not only locally.

## What to do

1. Add training and ranked write routes to the worker with AP, pay, and dedupe.
2. Prove settle, replay, and dedupe on the D1 shim.
3. Keep the full suite green and deploy when the user confirms.

## Done when

- Training returns a checksum without moving AP.
- Ranked moves AP, pays AC, replays identical, and dedupes keys.

## Not covered

OAuth and builder UI stay out of this task. Deploy needs the user token again.

## Notes

- 2026-10-26 start: waits on TASK-0020.
- 2026-10-26 done: worker runs auth, agents, compile, training, ranked end to end on the D1 shim; ranked moves AP, pays AC, replays identical, and dedupes keys. API suite 15/15, bundle dry-run clean.
