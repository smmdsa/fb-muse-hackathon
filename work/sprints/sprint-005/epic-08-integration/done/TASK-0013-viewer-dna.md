---
id: TASK-0013
title: Viewer DNA mode
work: M
eye: GLANCE
owner: agent
---

# TASK-0013 — Viewer DNA mode

## Why

The viewer still fights fixed SHADOW and BREAKER brains. Prompts must field the fighters.

## What to do

1. Add one prompt box per side in `game/agent-wars/`.
2. Compile each prompt with the same keyword map and rule pool as the mock.
3. Evaluate rules per tick with cover-based sight and drive the sim.
4. Smoke the page with no script errors and record the result.

## Done when

- Two different prompts field visibly different fighters.
- The same prompts and seed replay the same fight.
- Headless load shows no script errors.

## Not covered

Server validation and publishing stay out of this task. The viewer labels its compile as local.

## Verdict

User words on 2026-10-26: "test fixed". Checks 12 to 14 pass. The missing Meta model is accepted as planned.

## Notes

- 2026-10-26 start: epic-08 continues under sprint-005.
- 2026-10-26 done in code: prompt boxes compile with the mock keyword map and rule pool, rules drive each tick, shields block with BLOCK feedback. Syntax check and headless load pass, snapshot `tmp/snap-3`.
