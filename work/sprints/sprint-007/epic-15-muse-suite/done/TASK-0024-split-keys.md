---
id: TASK-0024
title: Split Meta keys per task
work: S
eye: NONE
owner: agent
---

# TASK-0024 — Split Meta keys per task

## Why

Two keys keep Spark spend apart from image spend on the Meta dashboard.

## What to do

1. Add `keyFor` and `hasKey` per task, with `META_API_KEY` as fallback.
2. Send the Spark key on chat calls and the image key on image calls.
3. Add `reasoning_effort: "low"` per the official chat docs.
4. Default portraits to `1024x1024` per the image docs.
5. Prove keyless calls never hit the network.

## Done when

- Compile without `META_SPARK_KEY` fails honestly with zero fetches.
- Portrait calls carry the image key alone.
- ai-provider 20/20, API suite green, worker dry-run clean.

## Not covered

Live calls wait on the two secrets. No caching yet.

## Notes

- 2026-10-27 done: chat plus image contracts confirmed on dev.meta.ai.
  Base `https://api.meta.ai/v1`, chat `POST /chat/completions` with
  `muse-spark-1.3`, images `POST /images/generations` with `muse-image-1.0`.
