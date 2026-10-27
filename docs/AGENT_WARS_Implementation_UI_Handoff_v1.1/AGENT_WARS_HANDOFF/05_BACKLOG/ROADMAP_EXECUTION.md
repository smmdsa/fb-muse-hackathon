# Execution roadmap — prioritization and sequencing
This is NOT a statement that all tasks are absent. Existing code in `packages/ranking`, `packages/autobattle`, `packages/tournaments`, `packages/economy`, API and viewer must be reused. Status `VERIFY_AT_HEAD` avoids stale audit claims.

## Work packages
- **Gate 0 (T001–T004):** establish source/deploy truth, canonical simulator, auth, settlement. If one cannot pass, Ranked demo is not production-worthy.
- **Core demo (T005–T010):** real Muse, canonical portrait, Breed Station, Chip Workbench, Install, esports lobby.
- **Competitive loop (T011–T015):** select active agent, ranked queue, fair energy reservation, replayed arena, AutoBattle scheduler/digest.
- **Competition and ship (T016–T017):** 8-person tournament UI and full E2E deployed demonstration.
- **Polish (T018–T025):** rank view, battle clarity, AI analysis, cosmetics, admin, fairness, load, responsive.
- **Post-hackathon (T026–T029):** seasons, public social profiles, art packs, advanced tournament formats.
- **Explicitly blocked (T030):** monetized RP purchases, paid entry, real prizes.

## Critical path
T001 → T003/T002 → T005/T006 → T007/T008 → T009 → T010 → T011/T012 → T013 → T014/T015 → T016 → T017. Parallelize art UI/design and QA only after API shapes are stabilized.

## Work discipline
Every task has a stable ID, dependencies and a measurable acceptance. Before editing, record actual state `already complete / partial / missing / blocked`. Submit small PR/commit; log changed files, migrations, tests, screenshot proof, blockers, and next task. No mock masquerading as real model; no payment activation; no synthetic stats reported as real.
