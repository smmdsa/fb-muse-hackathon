---
id: sprint-005
title: Integration milestone - prompt to payout
starts: 2026-10-26
ends: 2026-11-02
---

# sprint-005 — Integration milestone - prompt to payout

## The one sentence

One command turns a text prompt into a fought battle, an AP move, and an AC payout.

## Where this scope comes from

GDD primary loop in section 1, run with the mock provider from section 18.

## Objectives, and how each one is checked

| # | objective | check |
|---|---|---|
| 1 | Compiled DNA drives the sim per tick | `pnpm test` passes in `packages/battle-core` |
| 2 | `pnpm demo` runs the full loop | Human runs one command and reads the payout |

## Definition of done

- `pnpm demo "some prompt"` prints traits, winner, AP, and AC with no errors.
- All package suites stay green.

## What this sprint does NOT do

- Accounts, servers, and the builder UI stay out. This loop runs locally.
