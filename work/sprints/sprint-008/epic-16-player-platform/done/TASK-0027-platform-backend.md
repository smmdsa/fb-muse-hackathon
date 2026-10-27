---
id: TASK-0027
title: Platform backend — breeding, portraits, chips, dashboard
work: M
eye: NONE
owner: agent
---

# TASK-0027 — Platform backend

## Why

Heroes need a home: breeding with a portrait, a career from 500 AP,
and chips with numbers behind them.

## What to do

1. Tally chip triggers per tick in `fightPolicies`.
2. Add migration 0002: agent name, concept, portrait; version provider;
   match chips.
3. Breed through `POST /v1/agents` with the style-locked portrait.
4. Return provider plus isMock on every compile.
5. Serve the per-version chips dashboard.
6. Open CORS for the browser pages.

## Done when

- New leaders start at 500 AP in CIRCUIT I.
- Breeding without an image key returns a null portrait, honestly.
- Dashboard shows fights, wins, win rate, and triggers per chip.
- Full suite green, worker dry-run clean with 12 assets.

## Not covered

Live portrait proof waits on a route that calls the image key.
The keycheck rows stay in prod until asked to clean.

## Notes

- 2026-10-27 done: backend plus routes land. battle-core 12/12,
  ai-provider 22/22, API 17/17, full suite green, dry-run clean.
- 2026-10-27 fix: prod D1 misses migration 0002, so breeding and
  compile throw. Agents plus compile routes now answer JSON 500s.
  Run `npx wrangler d1 migrations apply agent-wars --remote`, redeploy.
