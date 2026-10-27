# Playwright test handoff — E2E scenarios
Browser audit from prior review was blocked (`ERR_BLOCKED_BY_ADMINISTRATOR`), so none of these tests should be labeled PASS until locally run and evidenced. Use Playwright tests against local Worker/D1 test database, then public staging.

## Mandatory fixtures
Seeded leader accounts A/B + admin, deterministic mock model for normal CI, opt-in real Muse smoke via secret in protected environment, independent match seed, time-travel server clock for lease expiry, fresh D1 for tests, 390 / 768 / 1440 viewports.

## E2E numbered acceptance scenarios
1. **New-user funnel:** signup → first screen → breed named single agent → portrait job success/fallback → refresh preserves ID and portrait → second breed denied.
2. **Birth style consistency:** sample 10 generated images with art Bible version and screenshot mosaic; verify framing manually plus basic dimensions and transparency/background.
3. **Chip:** create prompt → compilation loading → validated DNA/rules → version draft; matchmaking disabled before install → install → status persists after reload; unauthorized install rejected.
4. **Modes:** Training no AP; Casual no AP; Ranked vs eligible *offline* account modifies both AP symmetrically under nonfloor conditions; no bots in Ranked; deliberate cancel/timeout doesn't consume charge.
5. **Replay:** match id, seed, policy hashes/engine version yield equal checksum; Arena frames show same outcome; final winner cannot be client-tampered.
6. **Rank boundaries:** AP 0/99/100/299/300/1199/1200 map expected tiers/divisions, Singularity no floor; favorites/underdogs delta 12-28; duplicate settlement idempotent.
7. **AutoBattle:** explicit 24h activation; charges 10, regen +1/2h; consume only on starts; view without reactivating; expires on injected time; resume after reviewing; defensive cap.
8. **Tournament:** admin schedule → leader register and eligibility check → cutoff locks version → 8-player bracket → finals best of 3 → winner visible, replay links work; no lease charges used.
9. **Economy:** AC earn cap/idempotent, RP simulated, cosmetics equip and persist, no stats affected; insufficient funds and repeat transaction safe; no payment form.
10. **Accessibility/mobile:** all screens at 390px/768px/1440px, screenshot, focus, tab order, visible labels, reduced-motion animations, contrast, no overflow. Avoid brittle waitForTimeout; use network/state assertions.
11. **Security/concurrency:** token A cannot mutate B, no self Ranked, repeated simultaneous settle and purchase produce exactly one outcome.
12. **Live vs mock:** no-key -> visibly marked mock and no external claims; valid key -> actual Meta request and logged provider; failure graceful.

## Test artifact convention
`artifacts/e2e/{buildSha}/{caseId}/{viewport}.png`, `.trace.zip`, log JSON. QA report row: case, URL/build SHA, credentials fixture (not actual secret), actual result, expected, PASS/FAIL/BLOCKED, screenshot, trace, defect link.

## Suggested command sequence (adapt scripts to repo)
`npm install` or workspace-selected package manager → `npm test` → `npm run typecheck` → `npx playwright test` → `npx playwright show-report`. Verify package names/scripts from HEAD, do not assume they exist. CI uses mock provider; real Muse API only protected smoke.
