---
id: TASK-0004
title: Taste pass on viewer (house rules plus feedback)
work: S
eye: GLANCE
owner: agent
---

# TASK-0004 — Taste pass on viewer (house rules plus feedback)

## Why

The viewer reads as a default build. Taste house rules and game UI patterns lift it without new deps.

## What to do

1. Audit `game/agent-wars/` against the taste house rules and fix breaks.
2. Add one display face, one accent, flat square buttons with full states.
3. Add an end screen over the scene, hit feedback, and reduced-motion support.
4. Smoke the page with no script errors and record the result.

## Done when

- No gradients, glows, emojis, eyebrows, or icon cards remain.
- Buttons share one shape and one accent with hover, focus, and disabled states.
- A win or loss shows an end screen over the arena with stats and restart.
- Every hit draws feedback that clears on reset.
- Headless load shows no script errors.

## Not covered

Full Round 2 and 3 art passes stay open. No new packages or assets.

## Verdict

User words on 2026-10-26: "manual-test everything pass". All 11 hand checks pass on the shipped files.

## Notes

- 2026-10-26 start: read taste skill plus game-ui-ux skill. Plan set above.
- 2026-10-26 done: one display face, one accent, flat 2px buttons with hover, focus, and disabled states.
- 2026-10-26 done: end screen over the scene with stats and Fight again. Hit sparks, floaters, and bar flash. Reduced-motion pace.
- 2026-10-26 smoke: `node --check` passes. Headless load shows endcard and font link with no script errors. Snapshot `tmp/snap-2`.
- Eye verdict is pending: the user has not seen the new look yet.
