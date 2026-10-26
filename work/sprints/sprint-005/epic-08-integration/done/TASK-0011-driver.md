---
id: TASK-0011
title: DNA policy driver for the sim
work: M
eye: NONE
owner: agent
---

# TASK-0011 — DNA policy driver for the sim

## Why

Compiled DNA must steer a robot per tick. The driver maps intents to motion.

## What to do

1. Build observations from sim state with cover-based line of sight.
2. Map each movement intent to a steering vector and pass fire flags through.
3. Prove determinism and completion in `packages/battle-core/test/`.

## Done when

- Two mock-compiled policies fight 2700 ticks with legal state.
- The same prompt and seed give the same checksum.
- A policy with no matching rule still finishes through the fallback.

## Not covered

The demo script stays in TASK-0012.

## Notes

- 2026-10-26 start: epic-08 opened under sprint-005.
- 2026-10-26 close: 4 driver tests pass. Battle-core holds 11 green.
