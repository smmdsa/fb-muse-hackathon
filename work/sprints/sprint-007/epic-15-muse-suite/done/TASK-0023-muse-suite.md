---
id: TASK-0023
title: Muse suite repository for compile and portraits
work: M
eye: NONE
owner: agent
---

# TASK-0023 — Muse suite repository for compile and portraits

## Why

The MVP drafts agent logic and agent art with Meta's Muse suite.
One registry picks the model per task so a switch costs one env var.

## What to do

1. Add `models.ts`: suite catalog, per-task map, env overrides.
2. Add `meta.ts`: chat compile plus image portraits over plain fetch.
3. Add `repository.ts`: `providerFromEnv` and `portraitFromEnv`.
4. Wire local `flow.ts` and `worker.ts` to the factory.
5. Prove with stubbed-fetch tests and keep the suite green.

## Done when

- Compile maps to `muse-spark-1.3`, portraits to `muse-image-1.0`.
- Mock stays default without `META_API_KEY`; Meta serves with one.
- Every draft validates and repairs once; failures stay honest.
- Full suite passes and the worker bundle still builds.

## Not covered

No live Meta call runs here; the key arrives later as a secret.
No portrait caching yet; render once and store the URL.
Ranked and fights never call a model.

## Notes

- 2026-10-27 start: suite confirmed via Meta Model API guides.
- 2026-10-27 done: registry, meta client, repository, and wiring land.
  ai-provider 17/17, API 15/15, worker dry-run clean. No live call yet.
