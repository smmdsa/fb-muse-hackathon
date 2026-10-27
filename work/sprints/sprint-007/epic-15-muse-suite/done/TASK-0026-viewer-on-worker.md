---
id: TASK-0026
title: Serve the viewer from the worker URL
work: S
eye: NONE
owner: agent
---

# TASK-0026 — Serve the viewer from the worker URL

## Why

The worker URL answered 401 JSON at `/` because the worker is API-only.
The game viewer never shipped. One Worker must serve both.

## What to do

1. Add `[assets]` to `wrangler.toml` pointing at `game/agent-wars`.
2. Route every non-`/v1/` path to `env.ASSETS` in `worker.ts`.
3. Prove `/` serves HTML and `/v1/*` keeps its auth gate.

## Done when

- `/` returns the viewer shell, `/v1/health` still returns JSON.
- API suite 16/16, worker dry-run binds ASSETS.
- Next deploy shows the game at the worker URL.

## Not covered

The deploy itself. Secrets persist; the user deploys.

## Notes

- 2026-10-27 done: assets binding lands, viewer test passes, dry-run
  binds ASSETS next to D1. Awaiting deploy.
