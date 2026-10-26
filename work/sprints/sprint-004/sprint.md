---
id: sprint-004
title: S4 tournament slice - bracket core
starts: 2026-10-26
ends: 2026-11-02
---

# sprint-004 — S4 tournament slice - bracket core

## The one sentence

Organizer championships register leaders, lock versions, and run a reproducible single-elim bracket.

## Where this scope comes from

GDD section 8 (Championships) in `docs/AGENT_WARS_GDD_v1.0.md`, dated 2026-10-26.

## Objectives, and how each one is checked

| # | objective | check |
|---|---|---|
| 1 | Registration with cutoff, eligibility, and no dupes | `pnpm test` passes in `packages/tournaments` |
| 2 | Version lock at freeze | Locked versions never change |
| 3 | Deterministic 8-player bracket, best-of-3 final | Reproducibility tests pass |

## Definition of done

- All checks in the table pass.
- No deps added. No UI touched.

## What this sprint does NOT do

- Match engine hooks, prizes, and admin UI stay out. Later slices cover those.
