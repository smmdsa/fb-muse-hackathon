---
id: TASK-0020
title: Shared fight plus worker auth and publish
work: M
eye: NONE
owner: agent
---

# TASK-0020 — Shared fight plus worker auth and publish

## Why

Two copies of fight logic diverge. One shared runner keeps them honest.

## What to do

1. Move `fightPolicies` into `packages/battle-core` and reuse it in `flow.ts`.
2. Add an async D1 row layer plus auth, agent, and publish routes to the worker.
3. Prove with shim tests and keep the full suite green.

## Done when

- One fight runner serves the Node API and the worker.
- A token issues, an agent publishes, and an invalid draft fails on the shim.
- No `node:` import enters the worker graph.

## Not covered

Training and ranked write routes stay in TASK-0021.

## Notes

- 2026-10-26 start: epic-13 opened under sprint-006.
- 2026-10-26 close: shared runner in battle-core, flow and worker reuse it. All suites green.
