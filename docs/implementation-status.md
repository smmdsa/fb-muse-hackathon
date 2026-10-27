# Implementation status

Date: 2026-10-26. Sprint: sprint-006. This file tells the truth about what runs.

## What works

- Deterministic sim at 30 ticks per second with THE_FORGE map: runs. 7 tests pass.
- Same seed gives the same checksum in 100 repeats: runs. Test proves it.
- 1000 seeded fights finish with legal HP, energy, and bounds: runs. Test proves it.
- SHADOW.EXE, BREAKER.01, and BENCH policies: run. Tests use all three.
- Browser demo with Start, Pause, Restart, HP bars, and event feed: built. Load smoke passed in headless Chromium with no script errors. All 11 hand checks pass.
- Behavior DNA validator and evaluator: run. 14 tests pass. Bad drafts fail closed.
- Work board in `work/` with sprint, epic, and task files: exists.

## What is planned

- Round 1 code-review pass: done (snapshot `tmp/snap-1`, rules `tmp/game/rules.md`, one seed fix, carry-over clean).
- Taste pass: done, user verdict pass on all 11 hand checks.
- Scored visual critic and Rounds 2 to 3: pending. This shell has no screenshot tool.
- Manual play checks: all pass on 2026-10-26. See `docs/manual-test-s1.md`.
- S2 slice 1 done: `packages/behavior-dna` validates and evaluates policies.
- S3 ranking slice done: `packages/ranking` moves AP ±12 to ±28, maps tiers, rejects dupes and self-matches.
- S3 autobattle slice done: `packages/autobattle` gates matches on lease and stamina, caps defense at 3 per day, finishes in-progress matches before expiry.
- S4 tournament slice done: `packages/tournaments` registers with cutoff and eligibility, locks versions, runs a reproducible 8-player bracket with a best-of-3 final.
- S4 economy slice done: `packages/economy` runs an idempotent AC/RP ledger with a 150/day cap and a mock cosmetic shop. Real money stays locked.
- Integration milestone done in code: compiled DNA steers the sim per tick, and `pnpm demo` prints prompt, traits, winner, AP moves, and AC payout. User hand run is pending.
- Viewer DNA mode done in code: two prompt boxes compile locally and drive the fight, with a named compile line and shield feedback. Hand checks 12 to 14 cover it.
- Matchmaker slice done: `packages/matchmaker` picks server-owned opponents with eligibility, rolling pair caps, and nearest-rating order.
- Standings slice done: `packages/leaderboard` orders placed leaders by AP with deterministic breaks and top-N cuts.
- Local API slice done in code: `apps/api` serves demo-key auth, one-agent rule, mock compile plus validated publish, training, rated fights with replay, and standings. 10 route tests pass in-memory because this shell denies listening sockets; `curl` proof steps live in README for a hand run.
- Workers readiness done: `wrangler.toml`, `migrations/0001_schema.sql`, and a worker entry with health, leaderboard, and replay reads. A replay test proves identical checksums on a fresh migrated DB. Write routes stay on Node until the store ports to async D1.
- Remote is live: user pushed `feat/agent-wars-s1` and `main` through `d4f3867`. Walkthrough in `docs/judging-walkthrough.md`.
- Worker is live at https://agent-wars-api.smmdsa.workers.dev: D1 `agent-wars` migrated, seed match replays identical, leaderboard serves two ranks.
- Worker write-port done in code: the worker entry runs auth, agents, compile, training, and ranked end to end on an async D1 store. Ranked moves AP, pays AC, replays identical, and dedupes keys. API suite is 15/15 and the bundle dry-run is clean. Deploy waits on the user token.
- Overnight loop: energy gates every manual match through the stamina machine, the queue pairs nearest-ELO humans, casual falls back to a same-band bot after 30s, ranked waits 10min. Arena has a quick match card, profile shows energy. Slices A-C committed; hand tests cover queue plus energy.
- Live verify 2026-10-27: user migrated plus deployed. `/v1/me` serves energy 10/10. Breeding plus compile answer 201, dashboard works. BUT both calls fell back: portrait null, provider mock. The Meta secrets do not reach worker `fb-muse-hackathon` — likely set on the old `agent-wars-api` worker. Move both secrets over, then re-probe.
- Next session: confirm live provider plus portrait, clean prod test rows (`keycheck-spark`, `debug-breed`, `live-proof`), OAuth pick, AutoBattle lease UI, team modes call, visual rounds 2-3.
- Seasons slice done: `packages/seasons` archives the frozen board and resets every leader for the next season.
- Accounts, AI compile, and publish flow: planned for later S2 slices.
- Ranked AP ±12 to ±28, AutoBattle leases, championships, shop (S3 and S4): planned.
- Full acceptance suite from GDD section 14: planned. S1 covers gameplay rows only.

## Source docs

- GDD: `docs/AGENT_WARS_GDD_v1.0.md` (v1.0.0, dated 2026-10-26).
- Board rules: `work/README.md`. Horizon: `work/ROADMAP.md`.

## Known limits

- The viewer uses a small standalone sim. The canonical sim lives in `packages/battle-core`.
- `pnpm --version` fails on this drive with `EISDIR`. The repo uses npm workspaces until that is fixed.
- Git global config denies writes in this shell. The `safe.directory` fix needs a user shell.

## Handoff v1.1 close-out, 2026-10-27

Done and committed on `feat/agent-wars-s1`, full workspace suite green:

- T001 audit recorded in `work/sprints/sprint-009/epic-17-handoff-foundation/done/`.
- T002 canonical replay: `buildReplay` snapshots every 9 ticks, server recompute, bot replays.
- T003 crypto ids and tokens, ownership 404s, sliding throttles, static-only innerHTML.
- T004 atomic settlement: local `transact`, worker D1 `batch`, sabotage and dual-invocation tests.
- T005 compile cost audit: `tokens` and `latency_ms` on every version (migration 0004). Live Spark proof still needs `META_SPARK_KEY` on worker `fb-muse-hackathon`.
- T006 portrait pipeline: `ready`/`failed`/`faceless` statuses, retry route, contract canon style lock, 10-prompt QA test, seeded silhouette fallback.
- T007 breed station: fresh-leader loop test (one hero, second denied, dashboard round-trip).
- T008 chip workbench: DNA traits on every dashboard version plus workbench card.
- T009 explicit install: compile saves drafts, install route activates, queue takes the active version.
- T010 lobby shell: nav, agent card, mobile rules. Lab moved below the fold.
- T011 one open ticket per mode per leader, both stacks.
- T012 refunds: machine `refundManualMatch`, cancel route, ranked expiry refund, viewer copy and cancel button.
- T013 server arena replay: checksum-gated playback, econ end card, `?replay=` deep links.
- T014/T015 autobattle: 24h lease opt-in, bounded background pass (ranked vs humans, bots alone), return digest, profile panel, lobby line. Reads never renew.
- T016 championship: `s1-kickoff` 8-agent cup, frozen policies, auto-played bracket to champion, game replays, cup page (migration 0007).
- T017 smoke: `pnpm e2e:path` walks the whole user path over real HTTP and verifies the replay checksum. Green locally.
- T018 rank and history: dashboard history with deltas, payouts, foes, replay links.
- T025 minimum: focus-visible on buttons, links, inputs; arena canvas labelled.

Deferred with reasons:

- T005 live Spark plus T006 live portraits: blocked on the user moving both Meta secrets to worker `fb-muse-hackathon` and redeploying.
- T019 arena polish, T025 screenshots, T017 Playwright trace: no screenshot or browser tool in this shell. Needs user eyes or a capable session.
- T020 evolution lab, T021 armory shop, T022 admin auth, T023 defense audit, T024 observability, T026 seasons rotation, T027 public profiles, T028 skins, T029 Swiss: need R2, cron triggers, admin auth, or live traffic. None started.
- T030 paid RP: blocked by policy. Never build without explicit user approval plus payments review.

User checklist before the next session:

- Move `META_SPARK_KEY` plus `META_IMAGE_KEY` to worker `fb-muse-hackathon`, then re-probe compile and breeding.
- Apply D1 migrations 0004 to 0007 on the production database, then deploy.
- Run `pnpm e2e:path` against the local API, plus the 16 hand checks in `docs/manual-test-profile.md`.
- Push `feat/agent-wars-s1` when ready.
