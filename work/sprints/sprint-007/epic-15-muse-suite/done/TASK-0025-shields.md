---
id: TASK-0025
title: Rank shields for the five tiers
work: S
eye: NONE
owner: agent
---

# TASK-0025 — Rank shields for the five tiers

## Why

Each ELO tier needs its shield. Shields are earned, never sold.

## What to do

1. Generate five shields in one style, no text on the art.
2. Store them under `game/agent-wars/assets/shields/`.
3. Show a rank ladder in the viewer with AP bands from `tiers.ts`.

## Done when

- Five PNGs exist, one per tier, dark-navy style match.
- The viewer shows the ladder with correct bands.

## Not covered

PNGs are full size (~9 MB total). Downscale before any hosted ship.
Agent portraits still render at runtime through `META_IMAGE_KEY`.

## Notes

- 2026-10-27 done: prototype, circuit, core, ascendant, singularity land.
  Built with the local image tool, so no key spend.
- Downscaled to 512 px wide: 886 KB total, refs rechecked 5/5.
