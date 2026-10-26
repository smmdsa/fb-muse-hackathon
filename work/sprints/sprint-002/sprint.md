---
id: sprint-002
title: S2 builder slice 1 - DNA contracts
starts: 2026-10-26
ends: 2026-11-02
---

# sprint-002 — S2 builder slice 1 - DNA contracts

## The one sentence

Behavior DNA policies validate and evaluate with zero deps before any UI or server work.

## Where this scope comes from

GDD section 4 (Behavior DNA contracts) in `docs/AGENT_WARS_GDD_v1.0.md`, dated 2026-10-26.

## Objectives, and how each one is checked

| # | objective | check |
|---|---|---|
| 1 | Policy schema with allowlisted DSL | `node --test` passes in `packages/behavior-dna` |
| 2 | Fail-closed validation (depth, nodes, actions) | Rejection tests pass |
| 3 | Evaluator plus safe fallback | First-match and fallback tests pass |

## Definition of done

- All checks in the table pass.
- No deps added. No UI touched.

## What this sprint does NOT do

- No accounts, no AI compile, no publish flow. Later slices cover those.
