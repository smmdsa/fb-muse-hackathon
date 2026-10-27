# Judging walkthrough

Date: 2026-10-27. Remote: `feat/agent-wars-s1` at `2072569`, confirmed on origin.

## Script

Run each line in order. Every line prints its own receipt.

1. Open `game/agent-wars/index.html` with a double-click. Press Start battle.
2. Type two prompts and press Start. The compile line names traits and rules.
3. Run `pnpm demo "rush them down up close" "evade and stay far away" demo-judge`.
   Read the winner, the AP moves, and the AC payout.
4. Run `pnpm --filter @agent-wars/api dev` in a shell that can bind ports.
   Follow the four `curl` lines in README. Read the token, the version id,
   the training checksum, and the ranked AP move.
5. Run `pnpm test`. Read 119 green, 0 fail.

## Acceptance map

GDD section 14 rows and where each one is proven.

| Row | Proof |
|---|---|
| Same seed and hash give one checksum | `battle-core` determinism suite, 100 repeats |
| 1000 fights finish clean | `battle-core` bench test, legal bounds |
| Move plus aim in one tick | `battle-core` mirror suite |
| No hidden observations or rogue actions | `behavior-dna` validator rejects unknowns; driver fails closed on null sight |
| Equal ratings move +20 and -20 | `ranking` formula tests |
| 200 gap moves +12 and +28 | `ranking` formula tests |
| Same-match deltas match in size | `ranking` symmetry assertion |
| Duplicate and self matches denied | `ranking` ledger tests |
| Zero AP floor, divisions, Singularity | `ranking` floor test, `leaderboard` boundary tests |
| Lease expiry and reactivation | `autobattle` lease tests |
| Stamina spend and regen | `autobattle` stamina tests |
| Defense quota | `autobattle` defense tests |
| Tournament register, lock, bracket | `tournaments` suites |
| Wallet caps, idempotent shop | `economy` suites |
| Mock AI compiles, bad drafts fail | `ai-provider` suite |
| Replay is identical | `api` matches suite and `worker` replay test |

## Known gaps

- Rounds 2 and 3 need a screenshot-capable session. The code rounds are done.
- Write routes run on the Node API. The worker serves reads only.
- Real Meta calls are out. The mock labels itself on every result.
