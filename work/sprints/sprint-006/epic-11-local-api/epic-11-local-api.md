---
id: epic-11
title: Local API
work: L
eye: GLANCE
---

# epic-11 — Local API

## Goal

The loop runs over HTTP with persisted state and demo keys.

## The measurement this epic stands on

`pnpm test` in `apps/api` passes on 2026-10-26, and a `curl` pass hits every route.

## Technical sheet

| component | file | what changes |
|---|---|---|
| server | `apps/api/src/server.ts` | Routes, auth gate |
| store | `apps/api/src/store.ts` | SQLite leaders, agents, versions, matches |
| engine glue | `apps/api/src/flow.ts` | Compile, publish, fight, rank, pay |

## Board

The tree computes the board. This sheet holds no progress.

## Verdicts

None yet.

## Out of scope

Cloudflare deploy, OAuth, and builder UI stay out of this epic.
