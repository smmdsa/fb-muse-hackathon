# Implementation status

Date: 2026-10-26. Sprint: sprint-003. This file tells the truth about what runs.

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
