---
id: TASK-0003
title: Round 1 play plus rules.md plus fixes
work: S
eye: REVIEW
owner: agent
---

# TASK-0003 — Round 1 play plus rules.md plus fixes

## Why

The game skill sets three play rounds after the full build. Round 1 starts that loop.

## What to do

1. Copy the game folder to a snapshot folder outside the repo.
2. Play from a fresh load with real input and open every screen.
3. Write `/tmp/game/rules.md` with one line per numbered GDD rule, marked built or missing.
4. Fix majors and run the carry-over pass.

## Done when

- A scored critic pass exists for the snapshot.
- All blockers and majors have fixes or best-effort notes.
- The carry-over pass reads clean.

## Not covered

Look-and-feel steps 1 to 10 stay in Rounds 2 and 3.

## Notes

- 2026-10-26: brief saved word for word. Build covers S1 only so far.
- 2026-10-26: snapshot in `tmp/snap-1` (pre seed-fix). Rules in `tmp/game/rules.md`.
- 2026-10-26: code-review round found one major (dead seed input) and fixed it in `game/`.
- 2026-10-26: carry-over pass reads clean (no storage calls; reset clears all state).
- Scored visual critic is still pending: this session has no screenshot tool.
