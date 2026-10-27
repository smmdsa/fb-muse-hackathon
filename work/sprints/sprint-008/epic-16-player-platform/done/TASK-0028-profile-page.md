---
id: TASK-0028
title: Main nav plus profile page with dashboard
work: M
eye: NONE
owner: agent
---

# TASK-0028 — Profile page

## Why

Players need one screen for the hero, the training bench, and the numbers.

## What to do

1. Link arena and profile both ways.
2. Build `profile.html` plus `profile.js`: login, breed, train, dashboard.
3. Show the portrait, ELO, tier shield, AC, and per-chip triggers.
4. Style new blocks in the existing theme.
5. Write the hand-test list.

## Done when

- Profile signs in, breeds, compiles, fights, and refreshes the dashboard.
- Arena link reaches the profile and back.
- `node --check` passes on the new script.
- Hand tests live in `docs/manual-test-profile.md`.

## Not covered

No browser run here; the sandbox holds no display and no socket.
The user runs the ten hand checks on the deploy.

## Notes

- 2026-10-27 done: pages plus styles land, parse clean.
