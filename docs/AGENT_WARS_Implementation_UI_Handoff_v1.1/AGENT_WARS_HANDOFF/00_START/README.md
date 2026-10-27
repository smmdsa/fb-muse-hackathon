# AGENT WARS — Implementation + AAA Esports UI Handoff
Version 1.1 — 2026-10-27. Purpose: hand to Muse Code to complete the current repository safely.

## SOURCE OF TRUTH
- Repo: `smmdsa/fb-muse-hackathon` (branch observed `feat/agent-wars-s1`; always confirm latest HEAD).
- Published site: `https://fb-muse-hackathon.smmdsa.workers.dev/`.
- Read existing `docs/AGENT_WARS_GDD_v1.0.md`, `docs/implementation-status.md`, `work/ROADMAP.md`, `docs/judging-walkthrough.md` FIRST.
- This handoff is a prioritized implementation delta, not permission to rewrite implemented packages.
- Code observations reflect an audit of GitHub and page structure. Browser Playwright interaction with the live domain was BLOCKED in the audit environment. Every claim of working end-to-end requires fresh local Playwright evidence.

## HOW TO WORK
1. Audit HEAD vs this handoff; record statuses VERIFIED / PARTIAL / MISSING / BLOCKED and exact file/test evidence. Existing tests might prove only modules, not UI integration.
2. Implement tasks strictly by prerequisites and priority. Make a small commit per slice; preserve current packages and D1 schema, add migrations.
3. After EACH feature: unit tests + integration + browser E2E, screenshots desktop/mobile, accessibility smoke, screenshots/trace attachments, and update the task card.
4. Separate `mock` vs `live` Muse visually and in telemetry; never imply mock images/strategies are real.
5. Never enable real-money payments or paid tournament entry without regulatory review.
6. No arbitrary code execution from generated agents. Battle outcomes server-authoritative.

## DOC MAP
- `01_PRODUCT`: boundaries, progression, status model.
- `02_DESIGN`: exact esports UI handoff with dimensions, tokens, components, pages.
- `03_FLOWS`: Breed / Chip / Deploy → Queue → AutoBattle → Results + portrait art contract.
- `04_ENGINEERING`: services, data/API contracts and competitive safeguards.
- `05_BACKLOG`: detailed task sheets plus machine-readable tasks.json.
- `06_QA`: acceptance matrix and Playwright scenarios.
- `07_AGENT_PROMPTS`: paste-ready instruction for Muse Code.

## DEFINITION OF DEMO DONE
Fresh user enters app → authenticated Leader → breeds ONE visually coherent agent → writes tactical prompt and compiles REAL Muse policy (with explicit mock fallback) → installs one validated chip/loadout → selects/deploys the active agent → enters Casual/Ranked (no confusing second combat) → watches a server-verifiable replay and AP/AC result → enables 24h AutoBattle lease → observes an offline result, reviews, and explicitly reactivates → registers in a scheduled free 8-agent tournament → views bracket. All critical flows survive refresh and work at 390px and 1440px.
