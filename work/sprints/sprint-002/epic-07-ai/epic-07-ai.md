---
id: epic-07
title: Mock AI compile
work: S
eye: NONE
---

# epic-07 — Mock AI compile

## Goal

A prompt compiles to a valid Behavior DNA draft with no keys and no network.

## The measurement this epic stands on

`pnpm test` in `packages/ai-provider` passes on 2026-10-26.

## Technical sheet

| component | file | what changes |
|---|---|---|
| mock | `packages/ai-provider/src/mock.ts` | Keyword draft, one repair |
| adapter | `packages/ai-provider/src/index.ts` | Provider pick, mock default |

## Board

The tree computes the board. This sheet holds no progress.

## Verdicts

None yet.

## Out of scope

The real Meta adapter stays out until credentials exist. The mock never claims to be Meta.
