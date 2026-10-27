---
id: TASK-0032
title: T001 audit HEAD vs handoff v1.1
work: S
eye: NONE
owner: agent
---

# TASK-0032 — T001 audit (handoff)

## Method

Read all nine handoff files, the GDD, and the repo. Probed live
`https://fb-muse-hackathon.smmdsa.workers.dev` with node fetch.
Live build is current: `/v1/me` serves energy, queue route validates.

## Verdicts with evidence

- T001 audit itself: done here.
- T002 canonical engine: PARTIAL. `battle-core` is canonical and shared
  (`packages/battle-core/src/simulation.ts`, driver, 13 tests). The viewer
  `game/agent-wars/game.js` is a second standalone sim; no server replay
  render exists. Replay checksums prove sim equality only.
- T003 auth: PARTIAL. Bearer tokens gate every mutation; ownership checks
  tie agents, versions, tickets to the leader. Gaps: `mintId` is
  `Date.now()+counter` (predictable, handoff forbids), demo tokens use
  `Math.random`, no rate limits, no admin role, handle-only demo sign-in.
- T004 settlement: PARTIAL. Idempotency keys plus dedupe plus replay
  equality hold (15 API tests). D1 writes are sequential awaits, no
  batch/transaction; no dual-concurrency test.
- T005 live Muse: PARTIAL. Client, registry, split keys, provider labels
  ship. Live breed fell back: portrait null, provider mock. Secrets do
  not reach worker `fb-muse-hackathon`.
- T006 portraits: PARTIAL. Style lock plus URL storage ship. No async
  job/status route, no retry, no R2, no fallback silhouette.
- T007 breed station: PARTIAL. Profile breeds, second breed denied (409),
  faceless path honest. No pending/failed art states in UI.
- T008 chip workbench: PARTIAL. Dashboard shows DNA plus chips plus
  triggers. Compile auto-activates the version (implicit install).
- T009 install: MISSING. No install route; compile sets active_version_id.
- T010 app shell: PARTIAL. Arena plus profile pages with theme. No
  unified shell, lobby, or championships/armory nav.
- T011 queue select: PARTIAL. Casual/ranked quick match ships. No
  install gate, duplicate queued tickets allowed.
- T012 refunds: MISSING and divergent. Spend happens at request; ranked
  expiry keeps the charge; no cancel route. Handoff wants spend at match
  start plus refund on cancel/expiry.
- T013 server arena: MISSING. Viewer never renders a server replay.
- T014 scheduler: MISSING. Machine exists; no activate/status/digest
  routes, no background fights.
- T015 digest: MISSING.
- T016 tournament UI: MISSING. Package plus seed paths exist; no routes
  or pages.
- T017 E2E: MISSING. No Playwright in repo; sandbox holds no browser.
- T018 rank/history: PARTIAL. Static ladder ships; no history UI.
- T019 arena polish: PARTIAL. Hit feedback plus shields ship; no reduced
  motion, no 2x/4x replay controls.
- T020 evolution lab: MISSING.
- T021 armory: PARTIAL. Economy ledger plus mock shop ship; no UI,
  no purchase/equip routes.
- T022 admin: MISSING (no admin paths exist, so nothing is exposed).
- T023 defense caps: PARTIAL. Caps live in machine/tests; offline pool
  plus fairness audit missing.
- T024 observability: PARTIAL. `pnpm bench` plus receipts; no cost
  tracking, no error telemetry.
- T025 a11y: PARTIAL. Theme plus media queries; no focus/keyboard pass,
  no screenshot proof.
- T026 seasons: VERIFIED. Archive plus reset with tests.
- T027 social: MISSING. T028 skins: PARTIAL (shields only).
- T029 formats: PARTIAL (single elimination only).
- T030 payments: BLOCKED by design. No checkout exists; keep it so.

## Security notes for later slices

- `mintId` predictable: replace with crypto random in store and worker.
- Demo tokens `Math.random`: move to `getRandomValues`.
- InnerHTML uses are static strings only (game.js feed clear,
  profile.js empty state): safe, keep textContent elsewhere.
- CORS `*` with bearer tokens: same-origin asset serving mitigates;
  note in T003.
- No rate limits on auth/compile/queue: add per-leader cooldowns.
- Client-submitted winner/AP/AC: none accepted; sim settles all.

## Done when

- This file commits. Slices follow handoff dependency order.
