# Ordered task cards

## T001 [P0] Audit deployed HEAD vs repo and rebaseline task statuses
- **Epic:** FOUNDATION
- **Dependencies:** none
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Record commit SHAs, actual deployed routes, working tests; identify drift; no unproven claims.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T002 [P0] Consolidate canonical battle engine and replay render
- **Epic:** FOUNDATION
- **Dependencies:** T001
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Viewer consumes canonical simulation/replay snapshots; 100 seeded outcomes and checksums match server.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T003 [P0] Secure auth and ownership
- **Epic:** FOUNDATION
- **Dependencies:** T001
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Only owner can mutate agent/chip/tickets, separate admin; sessions work across reload and browser.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T004 [P0] Transactional idempotent ranked settlement
- **Epic:** FOUNDATION
- **Dependencies:** T003
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Concurrent duplicate settle changes rating, AP, AC once; retry safe; no half-commits.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T005 [P0] Wire real Muse Spark compile end-to-end
- **Epic:** AI
- **Dependencies:** T003
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Live key path invoked server side; invalid JSON rejected, mocks always labeled; audited costs.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T006 [P0] Implement stable portrait art pipeline and storage
- **Epic:** BREED
- **Dependencies:** T003
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** One canonical full-body 3/4 robot portrait; statuses; 10-prompt visual QA; R2/fallback.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T007 [P0] Build Breed Station in shared app shell
- **Epic:** BREED
- **Dependencies:** T006
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Fresh user creates one agent; handles pending/failed art; impossible to create second.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T008 [P0] Build full chip compiler and tactical preview UI
- **Epic:** CHIPS
- **Dependencies:** T005, T007
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Shows DNA values and legal policy rules; errors meaningful; version saved; no implicit install.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T009 [P0] Implement explicit install chip contract and UI
- **Epic:** CHIPS
- **Dependencies:** T008
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Atomic validated install; selected version matches active version after refresh; install blocked invalid.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T010 [P0] Implement polished unified app shell and lobby
- **Epic:** UI
- **Dependencies:** T003
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Real navigation, no debug home; above-fold agent/Rank/AP/Autobattle/Play; desktop+mobile.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T011 [P0] Agent selection and queue mode selection
- **Epic:** MATCH
- **Dependencies:** T009, T010
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** One agent card selected, Training/Casual/Ranked; no chip prevents queue; no duplicated tickets.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T012 [P0] Fix queue energy reservation and timeout refunds
- **Epic:** MATCH
- **Dependencies:** T011, T004
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** No charge spent for canceled/expired unmatched ticket; spending only on match start.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T013 [P0] Server-linked Arena viewer and result screen
- **Epic:** MATCH
- **Dependencies:** T002, T011
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Rendered replay matches stored match checksum; mode-specific AP+AC shown once.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T014 [P0] Wire automatic scheduling and 24h authorization
- **Epic:** AUTOBATTLE
- **Dependencies:** T004, T011
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Background fights occur when energy+lease valid, stop on expiration and energy depleted; user need not stay online.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T015 [P0] Create return digest and explicit reactivation UI
- **Epic:** AUTOBATTLE
- **Dependencies:** T014
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Offline summary, energy, reasons, reactivation action; visiting never renews lease.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T016 [P0] Championship enrollment page and bracket integration
- **Epic:** TOURNAMENT
- **Dependencies:** T010, T011
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** 8-agent free event; register eligible frozen policy; view live/complete bracket and replay.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T017 [P0] E2E smoke, mobile, deploy and judge path
- **Epic:** RELEASE
- **Dependencies:** T013, T015, T016
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Fresh-user entire path recorded with trace/screenshots; stable Workers site and verified Muse real-mode.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T018 [P1] Rank/leaderboard and match history presentation
- **Epic:** UI
- **Dependencies:** T010, T013
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** All tiers/divisions correct, AP progress, history and replay links, loading/empty states.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T019 [P1] Arena polish including hit feedback and objectives
- **Epic:** GAMEPLAY
- **Dependencies:** T002
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Hits/shield/dash clear; cover and TTI fixed; center objective; motion reduced option.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T020 [P1] Battle analysis and Evolution Lab
- **Epic:** AI
- **Dependencies:** T013, T005
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Muse explanations grounded in telemetry; changes tested A/B, no unverified winrate claims.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T021 [P1] Armory mock catalog, AC/RP wallets, equip cosmetics
- **Epic:** ECONOMY
- **Dependencies:** T003, T010
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Idempotent purchases and entitlement equip; no gameplay stat effects; real money disabled.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T022 [P1] Organizer admin event authoring and status transitions
- **Epic:** TOURNAMENT
- **Dependencies:** T016, T003
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Admin-only DRAFT→ANNOUNCED→REGISTRATION→LOCKED→LIVE→COMPLETED.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T023 [P1] Defense caps, opponent fairness and audit
- **Epic:** AUTOBATTLE
- **Dependencies:** T014
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Offline pool enforces published version, pair caps, defense limit; observable reasons.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T024 [P1] Load/latency/cost benchmarks and observability
- **Epic:** PERFORMANCE
- **Dependencies:** T017
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Measure latency/CPU per fight, Muse spend, D1 concurrency, queue, errors.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T025 [P1] UX accessibility and responsive regression
- **Epic:** UI
- **Dependencies:** T017
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** 390px, 768px, 1440px screenshots; keyboard, focus, reduced motion, contrast, no horizontal overflow.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T026 [P2] Season history, placement and award distribution
- **Epic:** SEASONS
- **Dependencies:** T018
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Archive standings once, soft reset, placement consistency, no duplicate rewards.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T027 [P2] Public leader profiles, shared matches and discoverability
- **Epic:** SOCIAL
- **Dependencies:** T018
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Public share pages respect privacy and report abuse controls.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T028 [P2] Expanded avatar skins and animation library
- **Epic:** COSMETICS
- **Dependencies:** T021
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** All visuals preserve canonical silhouette/framing, no gameplay impact.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T029 [P2] Swiss/double elimination and season circuits
- **Epic:** TOURNAMENT
- **Dependencies:** T022
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** More formats isolated from first 8-person bracket; fairness tests.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).

## T030 [BLOCKED] Real RP purchase / paid entry / cash prizes
- **Epic:** PAYMENTS
- **Dependencies:** legal approval
- **Scope:** Implement/verify only this vertical slice; reuse existing work.
- **Acceptance:** Disabled until payments, legal, age, jurisdiction and abuse reviews; no active checkout.
- **Proof:** exact changed paths and commit; repeatable automated test; Playwright trace/screenshots for user-facing flows.
- **Status:** VERIFY_AT_HEAD (not confirmed missing).
