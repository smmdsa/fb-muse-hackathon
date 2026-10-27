---
id: TASK-0033
title: T002 canonical engine plus server replay snapshots
work: M
eye: NONE
owner: agent
---

# TASK-0033 — T002 (handoff)

## What changed

- `buildReplay` in battle-core: frame every 9 ticks plus final frame,
  hit/KO events from HP transitions, byte-identical per seed.
- 100-seed sweep test ties every replay checksum to `fightPolicies`.
- Both replay endpoints return the snapshot; bot fights replay from
  the matching preset instead of 410.
- New worker tests cover human plus bot replays.

## Evidence

- battle-core 14/14 (replay suite 2/2), API green, full suite green.
- `pnpm test` zero fails.

## Split noted

- Viewer frame rendering ships with T013 (server-linked arena), where
  the result screen owns the replay view. T002 proves the canonical
  snapshots plus endpoint contract here.

## Done when

- Committed. Next: T003 secure auth.
