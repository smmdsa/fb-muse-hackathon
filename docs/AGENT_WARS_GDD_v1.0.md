# AGENT WARS — Game Design Document + Technical Implementation Specification

**Version:** 1.0.0  
**Date:** 2026-10-26  
**Status:** Approved product direction; implementation specification, not claim of implementation  
**Audience:** Muse Code / autonomous coding agent operating on a local repository  
**Primary mode:** Robot Arena Combat (browser, 1v1 autonomous agents)  
**Milestone:** playable end-to-end hackathon vertical slice; commercial roadmap afterward.

> **EXECUTION DIRECTIVE FOR MUSE CODE:** Read this entire document before coding. Inspect the current repository; preserve usable existing work, particularly any `battle-core` prototype. Write `docs/implementation-status.md` distinguishing actual working features from planned ones. Implement the milestones in dependency order with tests. Do not silently reinterpret product constraints. If access to Meta APIs, keys, hosting, domain, or payments is missing, provide a deterministic mock adapter with a clear configuration interface; never pretend an integration works. Keep secrets server-side. Continue working through the defined sprint without asking about routine implementation choices.

## 0. Product decisions and source of truth

AGENT WARS is a free-to-play competitive game in which a human **Agent Leader** designs the behavior of an autonomous combat robot; robots fight in a deterministic 2D top-down arena. Regular daily play happens through Training, Casual and Ranked AutoBattle. Separately, organization-created **Championships** have scheduled registration, eligibility and seeded brackets. The user may watch any battle, live or via replay.

**Decisions fixed for hackathon MVP:**
- One Agent Leader account owns **one agent only** in hackathon phase. Architecture supports N agents later; at most one `active_agent_id` per owner always.
- One active agent can fight in Training, Casual and Ranked, including queued offline AutoBattles where permitted. No simultaneous official matches for one agent.
- Ranked AP increases for wins and decreases for losses, nominal ±20 modified to ±12...±28 according to relative rating and match expectation, **not subjective performance stats**.
- Inactivity guard: an agent becomes `IDLE` when its activation lease expires **24h after the Leader's last explicit activation/reconfirmation** (do not extend by background API requests). Energy budget can halt AutoBattle earlier. Returning to the web app does not silently restart: the Leader reviews a summary and explicitly clicks `Reactivate`.
- Energy is an **AutoBattle scheduling budget**, NOT a combat stat nor a purchased competitive advantage. It must never affect weapon power, win probability, AP magnitude or manual Ranked eligibility. It refills without payment; users can watch battles freely.
- Tiers: PROTOTYPE, CIRCUIT, CORE, ASCENDANT (III, II, I for each), SINGULARITY (no divisions, ranked by AP). Initial numerical thresholds are configurable.
- The official Rank is owned by the **Agent Leader**, not an individual robot; agent versions retain individual stats.
- The leader must explicitly opt into AutoBattle, select eligible queue and review/renew at most once per 24-hour session; its offline defense can be used only by the authoritative matchmaker.
- Tournament registration is free in MVP; premium-currency entry and real-money purchases are explicitly disabled pending legal and payments review.
- RP and AC are cosmetic-only; AP are not spendable.
- No unreviewed generated code runs as player strategy: Meta model output is validated Behavior DNA, not executable JS.

## 1. Player fantasy, design pillars and gameplay loop

**One-line pitch:** *Build the brain. Enter the arena.*

Player goals: author a clever agent, learn from fights, climb ranks, enter official tournaments, collect prestige and customization. A session lasts 2–10 minutes, and AutoBattle supports asynchronous return sessions.

**Primary loop:** Create/modify Behavior DNA → Training → queue Ranked → inspect battle/replay → AI tactical feedback → publish improved immutable agent version → continue climb.

**Secondary loop:** Register for upcoming Championship → freeze eligible published agent version at registration lock → scheduled automated bracket → watch/replay → receive cosmetic status/rewards.

Core principles: fair deterministic rules; explainable outcomes; no pay-to-win; resilient asynchronous competition; low friction mobile-first UI; auditable AP/economy; safeguards against farming.

## 2. Game modes and scope

| Mode | Other player required live? | Uses AP? | AutoBattle eligible? | Notes |
|---|---|---|---|---|
| Training | No | No | No | Predefined AI benchmarks, seed control, unlimited |
| Casual | No | No | Optional later | Published agents, no rank impact |
| Ranked | No | Yes | Yes | Server chooses eligible opponent; fixed published versions |
| Championship | No | No direct AP by default | Separate scheduling | Organizer creates, players register; bracket independently scored |

No live-human steering, MOBA map, teams, loot stats, pay-to-win boosts, item drops or cash prizes in MVP. A battle view and replay are spectatable regardless of whether the Leader is currently active.

## 3. Arena gameplay v1

- Top-down arena 24 × 16 world units; fixed 30 ticks/s for 90 s, max 2700 ticks.
- Symmetrical map `THE_FORGE`: 2 mirrored spawn zones, 4 symmetric cover blocks, central control objective, safe spawn positions.
- Agents: radius 0.35, base speed 4 units/s, HP 100, combat energy 100, combat energy regeneration 8/s.
- Basic gun: one projectile, 10 damage, max 2 shots/s; blocked by cover; deterministic collision (swept checks to prevent tunneling).
- Dash: combat energy cost 25, 3s cooldown; shield: combat energy cost 20, 0.8s active, explicit cooldown configured after testing.
- Combat energy in arena is entirely separate from AutoBattle stamina/credits used for scheduling.
- At time expiry, scoring: primary damage dealt net of healing (no healing in MVP), secondary control point occupancy; cap penalty for stalling; precise integer scoring and tie breaking implemented server side. Alternating spawn sides and paired seeds in official evaluation.
- Robots may aim and move simultaneously; action carries continuous movement vector, aim vector, fire, dash, shield.
- Observation updates at 10 Hz; controls applied at 30 Hz between AI evaluations.
- Allowed observation: own stats/cooldowns, visible opponent or last seen position, visible projectiles and estimated threat, map and objective, tactical memory. Never exact hidden opponent cooldowns or unrevealed RNG state.

**Initial agents:** `SHADOW.EXE` (aggression 35, evasion 80, distance 65, conserve 70), `BREAKER.01` (80,30,20,35), and a balanced reference benchmark. Behavioral priority uses hysteresis, bounded actions and conservative energy usage.

## 4. Behavior DNA contracts

A policy has `schemaVersion`, `agentVersionId`, four `dna` traits 0–100, bounded `rules` array (max 32 initially), stable IDs, and action parameters. Rules contain ordered predicates from an allowlisted condition DSL, one selected movement intent and independent optional fire/ability intents. Use Zod or JSON Schema on both server and client; server is authoritative.

**Condition operands allowlist:** own HP%, combat energy, distance if visible, projectile TTI, cover distance, line of sight, own cooldown ready, opponent last seen age, objective distance, arena time remaining, edge proximity. Logic operators `all`, `any`, `not`, numeric gt/gte/lt/lte, boolean eq; max predicate depth 4 and max nodes 64. No arbitrary expressions, eval, script snippets, filesystem access or network calls.

**Actions allowlist:** `APPROACH`, `RETREAT`, `KITE`, `STRAFE`, `SEEK_COVER`, `CAPTURE`, `AIM`, `FIRE`, `DASH`, `SHIELD`; runtime translates intents to `AgentAction`. Always normalize vectors; clamp costs/cooldowns; fail closed on unknown actions. A fallback safe policy must always exist.

**Meta compile flow:** player prompt → server `AIProvider.compileStrategy(prompt, agentContext, schemaVersion)` → model returns policy draft → schema validate → simulation sanity test → version preview → player explicitly publishes. On bad outputs: one repair attempt, then helpful validation errors. Record prompt/model identifier/token usage/latency without exposing private keys. **Model provider adapter** (Meta / deterministic mock), no hard-coded assumption about exact model name or API shape before verifying provider docs and access. AI post-match analysis receives telemetry with grounded events; proposed amendments require user approval and tests. The model never decides game winners.

## 5. Agent Leader, agents and versions

- `users`: identity/auth provider ID.
- `agent_leaders`: stable handle, display name, `active_agent_id`, `last_seen_at`, leaderboard visibility, region.
- `agents`: leader ID, base identity, cosmetics, `active_policy_version_id`, active flag, created_at.
- `agent_versions`: immutable policy JSON, content hash, engine compatibility, publish timestamp, tests status.
- Phase 1 enforces **one owned agent per Leader** in API + database transaction, despite future-proof one-to-many schema.
- Future N agents: switching active agent only outside an active ranked run/match/tournament lock; only one active at a time.
- Rank/MMR belongs to leader; match result records the particular agent and version used.

## 6. AP/MMR rating specification (crucial)

Use a **zero-sum skill update** for legitimate 1v1 Ranked matches. Rating, AP and division must not depend on kills, damage, survival, cosmetics, premium currency, paid entries or number of matches alone. Such factors would incentivize exploiting scoring/boosting.

**Hackathon simplified rating system:** store integer `ap` with initial 500 after 5 placement matches (provisional); optionally store separate precise float `mmr` initialized to 1000 and initially derive AP via `ap = round(clamp(mmr - 500, 0, ...))`. Avoid maintaining two freely drifting rating numbers. **Preferred implementation:** maintain `rating_fp` as signed integer fixed point, starting at 1000.000, and expose `AP = max(0, round(rating_fp - 500))`. `MMR` is `rating_fp`, not an independently modifiable score. This yields initial AP = 500. If a clamp at AP floor would otherwise destroy zero-sum, matchmaker updates unconstrained rating internally but displays AP floor; report floor effects.

For a completed decisive match:

```
EA = 1 / (1 + 10 ^ ((RB - RA) / 400))
SA = 1 if A wins else 0
rawDeltaA = 40 * (SA - EA)
visibleDeltaA = sign(rawDeltaA) * clamp(round(abs(rawDeltaA)), 12, 28)
visibleDeltaB = -visibleDeltaA
```

At equal ratings: winner +20 / loser -20. A highly unexpected win approaches +28, favored win approaches +12; unexpected loss about -28 and expected loss about -12. **Caveat:** the clamp deliberately overrides pure Elo mathematics; AP is a game-specific rating, not textbook Elo. A loss by a heavily favored player loses more, never less. For expected-score extremes this modified rule is not statistically calibrated: measure and revisit after population simulations.

**Important correction to the requested ±12..±28:** both sides' updates always have opposite signs and equal magnitudes. We do **not** independently calculate two separate clamped deltas (which could create AP inflation). Use deterministic integer rounding and a tie-handling rule specified below.

Examples with winner A:
- RA=RB: expected 0.500, A +20, B -20.
- RA=RB+200: expected ~0.760, A +12 (minimum), B -12.
- RA=RB-200: expected ~0.240, A +28 (cap), B -28.

**Tie:** design tournament battle resolution so Ranked match obtains a decisive winner using control score and seeded tiebreak; technical no-contest yields no AP update. Draws due to legitimate exact tie: both `score = 0.5` and unclamped Elo update, rounded symmetrically; if equal ratings, 0/0. Prefer deterministic gameplay tie-break over rating-consuming draws.

**Placement and uncertainty:** first five Ranked games provisional and surfaced as placement status; process rating updates at same K for MVP and suppress official rank badge until five. If the player has no opponents, seed trusted system bots as unranked sparring only; **never mint AP by defeating nonhuman baseline bots**. Onboarding always works through Training, then ranked unlock depends on sufficient eligible human-owned policies. For demo, populate seeded demo Agent Leaders clearly labeled (test environment only) and disable production AP accrual against test accounts.

**Rank mapping configurable, temporary:**
- PROTOTYPE III: 0–99; II: 100–199; I: 200–299.
- CIRCUIT III: 300–399; II: 400–499; I: 500–599.
- CORE III: 600–699; II: 700–799; I: 800–899.
- ASCENDANT III: 900–999; II: 1000–1099; I: 1100–1199.
- SINGULARITY: AP >=1200, global standing ordered by AP and deterministic tie breakers; NO division.

**Anti-abuse:** one result per match ID; idempotent atomic update for both accounts; no self-matches; prohibit repeated rewardable pairs over configurable rolling window; matches authenticated and server-simulated; suspicious records flagged and voided before ledger updates; version locks; no retroactive AP changes except audited admin reversals. AP never tradable. No seasonal reset to zero; soft rating compression only after careful testing.

## 7. AutoBattle orchestration: offline without endless farming

**Two controls, both required:**

1. **Activation lease:** on explicit Leader activation/reconfirmation, `autobattle_lease_expires_at = now + 24h`. Reconnecting does NOT implicitly renew. At expiry the runner will not enqueue new matches; state -> `IDLE_EXPIRED`. Finish an already-authorized match safely. Return shows recap and calls for user review + explicit `Reactivate`.
2. **AutoBattle stamina (AS):** separate from combat energy. Initial max 10 charges. Each AutoBattle Ranked match *initiated by the owner* consumes 1 charge. Max scheduler rate 1 new auto-match every 15 minutes, maximum 10 owner-initiated matches per 24h. Charges regenerate one per 2 hours up to 10, but **the agent does not automatically resume after 24h lease expiry without explicit activation**. At 0 charges, state `IDLE_ENERGY`; recharged charges may resume automatically **only within a valid unexpired lease**; provide clear UI of next charge/lease expiry. No purchases, speedups or premium refill. Combat skill unaffected.

**Critical fairness design:** distinguish `ATTACK_QUEUE` (leader opts in and spends one AS per initiated AutoBattle) from `DEFENSE_ELIGIBILITY` (agent may be chosen as an offline opponent). Defense must not result in unlimited AP losses or gains with no human control. MVP safer policy: at most 3 defense matches credited to owner per 24h; additional defense simulations count as **unranked practice** for both parties or are rejected/rescheduled. Defense consumes no owner's AS, because the owner did not initiate it. Defense AP changes only if owner explicitly opted into ranked defense at activation and its lease is valid; expiration makes agent ineligible for defense AP. Every counted match updates both leaders. The matchmaking service must enforce per-pair and per-owner daily caps before execution to avoid one account farming another. Neither side has a privileged known seed, and ranked opponent selection is entirely server-owned.

**State machine:**
- `OFFLINE_DRAFT`: not published/not opted in.
- `ACTIVE_READY`: published, lease valid, AS > 0, no official match underway.
- `IN_MATCH`: match in progress; unique lock.
- `IDLE_ENERGY`: lease valid, AS == 0; cannot initiate; auto-resume if regenerated and opt-in remains true.
- `IDLE_EXPIRED`: lease expired, no new matches including rated defense.
- `PAUSED_MANUAL`: Leader manually paused; only explicit activation resumes.
- `TOURNAMENT_LOCKED`: registered policy frozen; tournaments follow their own independent scheduled match execution rules, which do **not** consume AutoBattle charges or require daily reactivation (registration consent is explicit).

**Transition authority:** server time, compare-and-swap/transactions, per-leader mutex/serialized coordinator. Job checks opt-in, lease, active agent version, AS, locks, opponent eligibility and daily quotas atomically immediately before enqueue. Requests retried safely using idempotency keys. Expiration wins over delayed queue callbacks. The user is never forcibly required to be online while an already-authorized battle finishes.

**Session UX:** first visit: one agent builder and `Start AutoBattle` CTA. Dashboard shows `Matches since last visit`, `W/L`, net AP, current rank, remaining AS, time until recharge, time until lease expiry, last significant defeat, replay link, AI suggestion. `Review & Reactivate` is explicit and accessible. Spectate now shows any running battle or most recent replay. No compulsive infinite engagement patterns; avoid push notifications by default.

**Scheduling cost caveat:** limit runs aggressively for hackathon; queue must not be polled at per-second scale. Server cron batch or Durable Object alarms may be used subject to validated Cloudflare CPU/runtime limits. Never implement a browser tab timer as authoritative 24h limit.

## 8. Championships

Organizer-only creation in MVP. Event lifecycle: `DRAFT → ANNOUNCED → REGISTRATION_OPEN → LOCKED → SEEDED → LIVE → COMPLETED`, with `CANCELLED` available before live. Fields: start date/time UTC, registration deadline, max players, minimum AP/rank, eligible region if relevant, number of matches per round, prize cosmetic catalog IDs, seeded bracket rules, locked agent version hashes.

Registration through authenticated leader account; unique registration per tournament and one eligible published active agent. Initial championship 8 players single elimination, best of 3 for final; initial rounds can be single match with symmetric seed/side considerations. Account that registered must remain owner; after lock no last-minute policy edits in that event. Tournament matches do not modify normal ladder AP in MVP (avoid double-reward/exploit), but yield event-specific standings/badges.

Tie breaker and capacity rules must be deterministic and posted before registration; registrations do not automatically occur through Ranked. Admin UI manages schedule, cancellation, emergency pause, audit and prizes. Tournament eligibility checked at registration and lock; if rank drops after lock, honor stated rules and avoid retroactive surprise removal.

## 9. Economy, compliance and UI

**AP:** rank rating, never currency.  
**AC (Arena Credits):** free earnable soft currency, cosmetics and profile personalization only; daily cap and diminishing incentives prevent bot farming. Example 25 AC first completed win, 10 AC loss, max 150 AC per day; **zero AC** for no-contest, suspicious, or repeated farmable matches.  
**RP (Reactor Points):** simulated premium currency, seeded wallet and test shop, **no real billing, buy UI, or payment callbacks**. Server may expose feature flag `realMoneyPaymentsEnabled=false` hard-locked in hackathon. Cosmetic prices placeholders; no stat bonuses, lootboxes, betting or player-to-player exchange. Entry with RP to tournament disabled pending legal review and age/regional compliance.

Economy is server-authoritative: `wallet_ledger` append-only, amounts integer, per-event idempotency key, atomic transaction, negative balances forbidden, ownership of cosmetic entitlement unique. Store each catalog price/version with purchase receipt. Tests cover double-submit, race conditions, unauthorized purchases, replay of API requests, impossible wallet values.

Required web UI pages/routes: `/` landing, `/onboarding`, `/dashboard`, `/agents/:id`, `/lab`, `/battle/:id`, `/ranked`, `/leaderboard`, `/championships`, `/championships/:id`, `/armory`, `/profile`, `/admin` (guarded). Mobile-first, accessible contrast, keyboard interactions, reduced motion toggle; battle rendering gracefully adapts to narrow mobile width. English initial localization with Spanish-ready i18n dictionary.

## 10. Technical architecture and contracts

Use **pnpm workspace TypeScript monorepo**, no dependency installation scripts (`ignore-scripts=true`) unless explicitly approved; review dependency versions, security and recency before adding. Keep battle engine browser + Node compatible with zero DOM dependencies. Practical structure:

```
apps/web/                  React + Vite, Phaser renderer adapter
apps/api/                  Cloudflare Worker router, auth, persistence
packages/battle-core/     deterministic fixed-point-ish numeric simulation
packages/behavior-dna/    DSL types, Zod schema, validator, evaluator
packages/ranking/         rating update, rank lookup, atomic result contracts
packages/autobattle/      leases, AS regeneration, state machine, quotas
packages/tournaments/     brackets, registration eligibility, locking
packages/economy/         wallet ledger, inventory, AC/RP rules
packages/ai-provider/     Meta adapter and mock adapter
packages/shared/          schemas, errors, identifiers
infra/                    D1 migrations, Wrangler configs, env sample
apps/web/public/          optimized art/assets
scripts/                  seed data, deterministic benchmarks
security/                 threat model
README.md
ROADMAP.md
docs/implementation-status.md
```

Technology: React + Vite UI; Phaser renderer (latest compatible stable release verified during implementation); Cloudflare Workers API, D1 relational DB, R2 replay archive, Durable Objects or equivalent serialized coordinator for battles; provider adapter for Meta model. Must measure full server-side simulation CPU cost before claiming Cloudflare free tier compatibility. For local dev, provide D1-equivalent SQLite or Wrangler local emulation and mock AI; no external account/key necessary for smoke test.

**Suggested endpoints:**

```
POST /v1/auth/session             // app's selected auth provider workflow
GET  /v1/me
POST /v1/agents
POST /v1/agents/:id/policies/compile
POST /v1/agents/:id/versions
POST /v1/agents/:id/activate
POST /v1/autobattle/start
POST /v1/autobattle/pause
POST /v1/autobattle/reactivate
GET  /v1/autobattle/status
POST /v1/matches/training
POST /v1/matches/ranked
GET  /v1/matches/:id
GET  /v1/matches/:id/replay
GET  /v1/leaderboard?seasonId=...
GET  /v1/seasons/current
GET  /v1/championships
POST /v1/championships/:id/register
GET  /v1/championships/:id/bracket
GET  /v1/wallet
GET  /v1/catalog
POST /v1/store/purchase
POST /v1/admin/championships // admin only
```

**Data constraints:** each player owns at most one agent in phase 1; one active agent per leader forever; unique `(match_id, rating_update_type)`, `(wallet_id, idempotency_key)`, `(tournament_id, leader_id)`; FKs and transactions; optimistic concurrency lock on policy publish/activation. Use UUID/ULID server-generated IDs, JSON schema versioning and pinned engine version and RNG seed per replay. Auth required except public spectating/leaderboard pages; per-leader authorization checked on every mutation. No trust in client win reports or currency balances. Avoid unsanitized agent names and prompt output injection to UI.

### Minimal contracts (TypeScript)

```ts
type RankTier = 'PROTOTYPE'|'CIRCUIT'|'CORE'|'ASCENDANT'|'SINGULARITY';
type Division = 'III'|'II'|'I'|null;
type AutoBattleState = 'OFFLINE_DRAFT'|'ACTIVE_READY'|'IN_MATCH'|
  'IDLE_ENERGY'|'IDLE_EXPIRED'|'PAUSED_MANUAL'|'TOURNAMENT_LOCKED';

type AgentDNA = {
  aggression:number; evasion:number; preferredDistance:number; energyConservation:number;
};
type AgentPolicyVersion = {
  id:string; agentId:string; schemaVersion:1; dna:AgentDNA;
  rules:ReadonlyArray<BehaviorRule>; sha256:string;
  engineCompatibility:string; publishedAt:string;
};
type RatingState = {
  leaderId:string; seasonId:string; ratingMilli:number; ap:number;
  placementGames:number; rankTier:RankTier|null; division:Division;
};
type AutoBattleStatus = {
  leaderId:string; agentVersionId:string; state:AutoBattleState;
  optIn:boolean; leaseExpiresAt:string|null;
  stamina:number; staminaMax:number; nextRegenAt:string|null;
  attackMatchesToday:number; creditedDefenseMatchesToday:number;
};
type RankedMatchResult = {
  matchId:string; engineVersion:string; seed:string;
  agentVersionA:string; agentVersionB:string;
  winnerLeaderId:string; checksum:string;
  durationTicks:number; rated:boolean;
};
```

The implemented types must fully specify BehaviorRule, Observation and AgentAction with strict schemas. Avoid `any`. Clock injection, random seed injection and persistence ports should be part of test seams.

## 11. Security and competitive integrity

- Server authoritative match outcomes, ratings, inventory and eligibility.
- Version pinning, deterministic RNG + fixed simulation engine hash per match/replay.
- No imported arbitrary JS/WASM for policy; rules DSL only.
- Validate authorization on every write. Server-owned game clock and timestamp constraints.
- Atomic pairing/lock acquisition, scheduler idempotency, no replay processing duplicate ratings.
- Limit API/model calls per user, logging and graceful error budgets.
- Explicit opt-in for offline rated fights, control of quota and pause.
- Prevent farming via opponent selection, rolling repetition caps and audit events.
- Transparent ranking FAQ; report both wins and losses, not only positive highlights.
- Feature flags default disabled for payments, premium entry, gambling-like loot and trade.

## 12. UX specification — key screen states

**Dashboard after return:** 24-hour status timeline, summary `X battles / W-L / ±AP / AC`, last 3 replays, insight card from AI, stamina and lease timers, prominent `Review & Reactivate`, direct `Watch battle`. If not active, status is honest (`PAUSED`, `ENERGY`, `LEASE_EXPIRED`). Visual hierarchy: single primary CTA; no clutter.

**Builder:** name + prompt field, behavioral traits, inspect compiled rules, sandbox combat preview, publish version; one agent only; editing drafts does not change active published policy until explicit publish and next match. Show AI errors and rate limits.

**Ranked:** prominent tier icon, division, AP bar, placement games, concise AP-change explanation and leaderboard, one-button manual battle or AutoBattle toggle.

**Battle viewer:** dynamic arena canvas, agent names, HP, combat energy, cooldowns, time, score, playback seek on replay, event feed and shareable URL. Live view receives snapshots from authoritative simulation; renderer never changes result.

**Tournaments:** upcoming / registration open / live / past tabs, requirement badges, event detail, register CTA, version lock warning, bracket and final results. Prevent duplicate registration.

**Store:** AC/RP wallet, catalog, preview skins, confirmations, owned states. No real-money prompts.

## 13. MVP phases and prioritized backlog

**P0 — mandatory vertical slice (hackathon):**
1. Full battle engine with SHADOW, BREAKER, benchmark policy; deterministic replay + tests.
2. Validated Behavior DNA compilation using Meta adapter, deterministic mock fallback.
3. Create authenticated demo Leader and **one agent**; prompt → compile → preview → publish.
4. Training battle and legitimate ranked battle with server-owned outcome.
5. AP formula ±12...±28, rank mapping and persistent leaderboard.
6. Opt-in AutoBattle, 24h activation lease, scheduling stamina, explicit reactivation, offline dashboard summary.
7. Organizer-created championship with 8 demo/real eligible leaders, registration, locked versions and visible bracket.
8. Mock AC/RP wallet and cosmetics shop with idempotent simulated purchase.
9. Working deployment or polished local browser demo, README, test report and a reproducible judging walkthrough.

**P1 — if P0 stable:** replays with scrubbing and shareable pages, AI analysis + policy improvement experiment, live spectator WebSockets, cosmetics polish and localization.

**P2 — commercial:** N agents, only one active; seasons, seasonal soft reset and rewards; advanced tournaments; fraud detection, scalable matchmaking, invoices/payments only after compliance.

**Sprint sequence:** S1 battle-core + contracts + deterministic tests; S2 account/AI builder + publish; S3 rated matchmaking/ranking/AutoBattle state machine; S4 championship/economy; S5 tests/performance/UX/deploy/hackathon submission.

Each sprint produces runnable UI, test evidence, docs updates and a known-good commit. Never advertise placeholder UI as implemented backend.

## 14. Acceptance tests (must be automated where possible)

**Gameplay**
- Same engine hash + seed + version hashes → same checksum in 100 repeats.
- 1000 seeded fights complete within limits, no NaN, illegal HP/energy, loops, unknown actions or geometry penetration.
- Both robots can move while aiming/shooting; mirror-map tests and spawn swap audit.
- Policies cannot access out-of-sight hidden observations or invoke arbitrary actions.

**Ranking**
- Equal-rated winner +20 AP, loser −20, result once.
- Higher-rated winner gets +12, lower-rated loser −12 for 200+ gap in supplied baseline example.
- Lower-rated winner gets +28, higher-rated loser −28 for 200+ gap in supplied baseline example.
- Underdog loss loses less; favorite loss loses more. Same-match changes have equal magnitude and opposite signs (except AP display-floor effects).
- Duplicate event/retry updates no further AP; self match and paired farm attempt denied.
- 0 AP floor, division boundaries, 1200 Singularity with no division, 5 placement matches gating official tier.

**AutoBattle**
- Lease expires at 24h after explicit activation, not later login or background read.
- At 0 AS, state IDLE_ENERGY, no new owner-initiated match; never deduct combat energy in wallet.
- AS replenishes by 1 per 2h (cap 10); no automatic renewal of expired lease.
- In-progress battle finishes if lease lapses but no new match queued.
- Returning after expiry shows recap but does not resume before explicit button click.
- Defense quota of 3 rated matches per 24h, unique opponent/pair limits.
- 1 active agent/leader, at most one rated match concurrently; tournament doesn't consume AS.
- Can spectate/replay even while agent idle.

**Economy / tournaments / auth**
- RP cannot be purchased with real money; AC/RP cosmetics have zero combat effect.
- Duplicate purchase command grants no extra item/spend; insufficient funds errors.
- Tournament register rejects after cutoff, ineligible agent, duplicated registration.
- Bracket is reproducible; player policy versions locked at freeze.
- Unauthenticated mutation blocked; Leader A cannot change B's agent/wallet/registration.

## 15. Core instrumentation and product targets

Log `leader_registered`, `agent_created`, `policy_compiled`, `policy_published`, `training_started`, `ranked_completed`, `autobattle_activated`, `autobattle_expired`, `autobattle_depleted`, `dashboard_returned`, `policy_revised`, `tournament_registered`, `cosmetic_purchased_mock`. Avoid personal raw prompt storage without explicit privacy policy and limits.

Early success indicators: onboarding completion, first real ranked match completion, 24-hour return and explicit reactivation, share of users that revise an agent after defeat, legitimate matches/active leader, tournament registrations. AP distribution and anti-abuse flags monitored daily. No invented traction numbers in hackathon presentation.

## 16. Definition of Done and submission walkthrough

A milestone is complete only if it **actually runs**, has passing unit + integration tests, clear errors, updated README/roadmap, no leaked keys, and known limitations documented. Final demo must work without live billing or missing credentials via a clearly disclosed mock if Meta access unavailable; **actual Meta calls must be demonstrated if this is an entry requiring Meta model use**. Never claim mock as real integration.

**Judging script:** open app → create Leader → design robot in text → generate and inspect Behavior DNA → publish → start Training → enter Ranked → see win/loss and ±AP + new division → opt into AutoBattle → advance test clock/seeded jobs to show battles, recharge, 24h lease expiry → return to dashboard and explicitly reactivate → register into organizer championship → watch bracket advance → spend test AC/RP on cosmetic → replay battle + AI analysis with measured differences.

Use clock-injection for tests and a dedicated admin-only demo-scenario seed button; never falsify public production metrics.

## 17. Explicit unknowns and resolution policy

1. Actual Meta API credentials, endpoint, pricing and quotas: verify official platform docs; implement adapter and mock.
2. Cloudflare CPU budget for server-side battle: benchmark before choosing Worker vs Durable Object vs separate compute; never rely on cron/browser timers for exactness.
3. Precise combat balance and AP calibration: initial parameters are hypotheses; run simulations and publish report.
4. Jurisdiction for premium-currency tournament registration and payment processing: disabled until reviewed.
5. Auth provider: choose supported low-configuration solution; enforce local demo mode + secure production flow.
6. Art direction: polished dark neon arena with disciplined visual hierarchy, coherent accessible palette, responsive design; gameplay information is never expressed by color alone.

## 18. Immediate coding instructions to Muse Code

1. Inspect filesystem and existing git status. Do not overwrite an existing project or discard changes. If no repo exists, scaffold the above monorepo with pnpm and locked dependencies.
2. Create `docs/implementation-status.md` with a truthful checklist and this GDD copied under `docs/GDD.md`.
3. Implement **S1 now**: deterministic 30Hz battle-core, legal schemas, SHADOW/BREAKER reference agents, React arena viewer, seed/replay controls and tests. Add 1000-fight benchmark.
4. Commit only validated work to local feature branch `feat/agent-wars-s1` (do not push without user instruction). Run test, lint, typecheck and build. Report concrete results and remaining blockers.
5. Continue toward S2–S5 in order where time permits; preserve architecture and tests. Use local mock service for Meta without keys and explicitly label it.
6. Document runnable commands `pnpm install --ignore-scripts`, `pnpm dev`, `pnpm test`, `pnpm build` and local configuration `.env.example`.

**Final product invariant:** the Agent Leader develops intelligence, Ranked measures ability, AutoBattle respects human control and energy limits, Championships reward participation and prestige, and cosmetics never buy combat advantage.
