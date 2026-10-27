# Manual test — S1

Date: 2026-10-26. Read this file and run each check by hand. The agent cannot do these checks: this shell has no screenshot tool and no real-input play.

## What the agent already proved

- 7 sim tests pass: 100-repeat checksum, 1000-fight bench, mirror and cover checks.
- Build smoke passes: 300 ticks, checksum `5e04e942`.
- Page load smoke passes: headless Chromium shows title, canvas, and controls with no script errors.
- Carry-over reads clean: the code holds no storage calls, and reset clears all state.

## Test by hand

1. Open `game/agent-wars/index.html` with a double-click. The title card shows "Build the brain. Enter the arena."
2. Press Start battle. Units move, shots fly, HP bars fall, the feed logs hits.
3. Change the seed to `mirror-test` and press Start. The pill shows "mirrored" or "straight". A new seed can flip the sides.
4. Press Pause. Motion stops and the pill shows "paused". Press Resume. Motion restarts.
5. Press Restart mid-fight. Tick returns to 0 and both HP bars refill.
6. Let one fight run to the end. A winner pill appears ("winner: A", "B", or "DRAW").
7. Resize the window narrow (phone width). The arena and HUD stay usable with no overlap.
8. Reload the page. It returns to the title card with tick 0. No old fight remains.
9. Let a fight end. An end screen covers the arena with the winner and tick count. Press Fight again.
10. Watch a hit land. A spark, a "-10" floater, and a white bar flash all show, then clear.
11. Unplug the network and reload. The page still works with a fallback font.
12. Type two new prompts and press Start. The compile line names traits and rules for Cyan and Crimson.
13. Run the same prompts and seed twice. The same side wins both fights.
14. Play until a shield triggers. The feed shows a BLOCK line and no HP falls on that hit.

## Report back

For each numbered check, send one line: pass, or what broke with the seed you used. Fails go to new tasks in `work/backlog/`.
