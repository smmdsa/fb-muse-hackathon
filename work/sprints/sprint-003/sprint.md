---
id: sprint-003
title: S3 ranking slice - AP plus tiers
starts: 2026-10-26
ends: 2026-11-02
---

# sprint-003 — S3 ranking slice - AP plus tiers

## The one sentence

Ranked results move AP by plus or minus 12 to 28 with zero-sum symmetry and tier mapping.

## Where this scope comes from

GDD section 6 (AP/MMR rating) in `docs/AGENT_WARS_GDD_v1.0.md`, dated 2026-10-26.

## Objectives, and how each one is checked

| # | objective | check |
|---|---|---|
| 1 | Zero-sum AP update with clamp | `pnpm test` passes in `packages/ranking` |
| 2 | Tier and division lookup | Boundary tests pass |
| 3 | One-result-per-match ledger | Duplicate and self-match tests pass |

## Definition of done

- All checks in the table pass.
- No deps added. No UI touched.

## What this sprint does NOT do

- Matchmaking, AutoBattle leases, and championships stay out. Later slices cover those.
