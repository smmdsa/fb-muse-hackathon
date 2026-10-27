---
id: TASK-0018
title: Workers readiness seam
work: S
eye: NONE
owner: agent
---

# TASK-0018 — Workers readiness seam

## Why

The repo must accept `wrangler deploy` without rework of schema or read paths.

## What to do

1. Add `wrangler.toml`, `migrations/0001_schema.sql`, and `apps/api/src/worker.ts`.
2. Prove the migration and read routes with a D1-shaped shim in `apps/api/test/`.
3. Document the deploy steps and the remaining write-port in README.

## Done when

- `wrangler.toml` names the app, the D1 binding, and the migrations dir.
- Migration SQL builds every table on a fresh database.
- Health, leaderboard, and replay reads pass against the shim.

## Not covered

Write routes stay on the Node API until the store ports to async D1. `wrangler deploy` itself needs the user account.

## Notes

- 2026-10-26 start: readiness work before the push.
- 2026-10-27 verification pass: replay test over a fresh migrated DB seeded with a leader, two versions, and a finished match. Health 200, leaderboard 200 with the seeded leader, replay 200 with identical:true. Suite holds 119 green.
- 2026-10-26 close: 3 worker tests pass. Migration builds all 6 tables on a fresh database. Full repo suite holds 118 green.
