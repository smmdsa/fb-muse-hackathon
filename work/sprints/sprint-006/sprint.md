---
id: sprint-006
title: Local API milestone - accounts and matches
starts: 2026-10-26
ends: 2026-11-02
---

# sprint-006 — Local API milestone - accounts and matches

## The one sentence

A local Node API issues demo keys, publishes versions, and settles training and ranked fights.

## Where this scope comes from

User picks on 2026-10-26: local Node API first, demo keys. GDD section 10 endpoints, local subset.

## Objectives, and how each one is checked

| # | objective | check |
|---|---|---|
| 1 | Demo auth plus one agent per leader plus compile plus publish | `pnpm test` passes in `apps/api` |
| 2 | Training and ranked fights plus leaderboard plus replay | Same suite, plus `curl` proof |

## Definition of done

- Every endpoint above answers on a local port with demo bearer tokens.
- SQLite file persists between restarts. No external service is touched.

## What this sprint does NOT do

- Cloudflare deploy, OAuth, and the builder UI stay out. Migration comes later.
