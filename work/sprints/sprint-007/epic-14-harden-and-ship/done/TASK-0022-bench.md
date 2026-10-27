---
id: TASK-0022
title: Benchmark plus demo gate
work: S
eye: NONE
owner: agent
---

# TASK-0022 — Benchmark plus demo gate

## Why

S5 ships when tests, a benchmark report, and a clean demo all pass.

## What to do

1. Add `scripts/bench.mjs` with a determinism gate and `pnpm bench`.
2. Run it, record real numbers in `docs/benchmark.md`.
3. Keep `pnpm demo`, `pnpm test`, and the worker dry-run green.

## Done when

- `pnpm bench` runs 20 fights twice each with matching checksums.
- `docs/benchmark.md` holds observed numbers, not estimates.
- Full suite passes with no new fails.

## Not covered

Live deploy still waits on the user token. Visual rounds still wait on eyes.

## Notes

- 2026-10-27 done: 54,000 ticks in 321 ms, 168,224 ticks/sec, 16.05 ms
  per fight. Reference `bench-000:280f44aa:B:2700` matches `pnpm demo`.
