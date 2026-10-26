---
id: TASK-0010
title: Mock compile plus one repair
work: S
eye: NONE
owner: agent
---

# TASK-0010 — Mock compile plus one repair

## Why

GDD sections 4 and 18 need a keyless local path. The mock proves the compile contract.

## What to do

1. Write the mock compiler with keyword drafts in `packages/ai-provider/src/`.
2. Run every draft through the DNA validator with one repair attempt.
3. Run `pnpm test` in the package and record the result.

## Done when

- The same prompt always compiles to the same valid draft.
- Aggressive and evasive prompts move the matching traits.
- One repair fixes an oversized draft; a bad schema still fails loudly.
- Every result says `mock` and never claims a Meta call.

## Not covered

The real Meta adapter stays out of this task.

## Notes

- 2026-10-26 start: epic-07 opened under sprint-002.
- 2026-10-26 close: 6 tests pass via pnpm. Fixed missing async on test callbacks. Full suite holds 91 green.
