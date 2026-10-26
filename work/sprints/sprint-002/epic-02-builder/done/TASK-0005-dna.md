---
id: TASK-0005
title: DNA validator plus evaluator plus fallback
work: M
eye: NONE
owner: agent
---

# TASK-0005 — DNA validator plus evaluator plus fallback

## Why

GDD section 4 needs one strict gate. Bad drafts must fail before they reach the sim.

## What to do

1. Write types, validator, evaluator, and fallback in `packages/behavior-dna/src/`.
2. Write rejection tests and behavior tests in `packages/behavior-dna/test/`.
3. Run `node --test` from the package folder and record the result.

## Done when

- A valid SHADOW-style draft passes with zero errors.
- 33 rules, depth 5, 65 nodes, unknown operand, and unknown action each fail.
- The evaluator returns the first match and the fallback when none match.

## Not covered

AI compile, accounts, and publish flow stay out of this task.

## Notes

- 2026-10-26 start: sprint-002 opened with contracts only.
- 2026-10-26 close: 14 tests pass via `npm test` (8 validate, 6 evaluate). Fixed two issues: `.mjs` tests hold no TS syntax, `node --test` needs explicit file paths. Test scripts in both packages now pin files.
