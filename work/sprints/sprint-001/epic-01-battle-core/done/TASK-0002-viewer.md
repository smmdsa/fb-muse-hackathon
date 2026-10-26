---
id: TASK-0002
title: Browser demo viewer for SHADOW vs BREAKER
work: S
eye: GLANCE
owner: agent
---

# TASK-0002 — Browser demo viewer for SHADOW vs BREAKER

## Why

S1 needs a visible fight. The viewer proves the sim plays in a browser.

## What to do

1. Build `game/agent-wars/` with `index.html`, `style.css`, and `game.js` as separate files.
2. Show a title card with a Start control, live HP and energy bars, and an event feed.
3. Run one load smoke of the exact files and record the result.

## Done when

- The page opens with no console errors.
- A human presses Start and watches agents move and shoot.
- Pause and Restart change the sim state.

## Not covered

Rank display, replays, and cosmetics stay out of this task.

## Verdict

User words on 2026-10-26: "perfect, it's working". The page opens and the fight plays.

## Notes

- 2026-10-26 start: wrote the three viewer files with a standalone demo sim.
- 2026-10-26 load smoke: headless Chromium renders title, canvas, and controls with no script errors.
- 2026-10-26 fix: seed input now picks straight or mirrored spawns. The pill shows the pick.
