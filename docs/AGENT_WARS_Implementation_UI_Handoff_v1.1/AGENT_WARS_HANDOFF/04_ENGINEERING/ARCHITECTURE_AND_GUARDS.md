# Engineering integration and safeguards
Current code evidence: `game/agent-wars/game.js` is a second standalone browser sim; `profile.js` allows breed/compile/training and uses localStorage token; `match.js` queues via same-origin REST; `apps/api/src/worker.ts` supports D1 routes; `packages/behavior-dna`, `ranking`, `autobattle`, `tournaments`, `economy` exist. Inspect latest branch before editing.

## Required integration architecture
- TypeScript monorepo; one reusable `battle-core` (pure deterministic, canonical logic) built for server and replay renderer. Browser renderer never settles Ranked result.
- Worker API + D1 persistent store, R2 generated art/replays, optional Durable Object orchestration for tournaments/active queues when justified. Avoid a forced microservice rewrite for hackathon.
- Owner-bound identity and proper sessions; never trust handle-only sign-in for real users. Protect against XSS/CSRF and token theft. Rate limit identity, prompt compilation, image generation, queue and purchase.
- Mutation idempotency keys and durable settlement ledger. Every ranked match has unique stable ID; atomic update of match, rating/AP, currencies, ticket status. D1 transactional strategy must be verified under concurrent requests. Do not read all players and rewrite all ratings as a substitute for transaction-safe 2-leader update.
- Avoid `Date.now()+isolateCounter` as primary IDs; use crypto random UUID. State TTL and retries must be deterministic at business layer (inject `now` into tests).
- Maintain pre-match AP/MMR snapshots, both version hashes, seed, engine hash, checksum; replay endpoint verifies and signals mismatch rather than silently showing local outcome.

## Additional endpoints to implement/verify (not all exist yet)
- `GET /v1/me` with leader rank, agent selection, lease + stamina.
- `POST /v1/agents` breeding with portrait job status and idempotency.
- `GET /v1/agents/{id}/portrait-status` and optional explicit regenerate.
- `POST /v1/agents/{id}/policies/compile` always returns provider and isMock; returns validated policy preview.
- `POST /v1/agents/{id}/install` explicit owner-verified chip activation.
- `GET /v1/agents/{id}/versions` with installed flag and prompt provenance.
- `POST /v1/matchmaking/request`; `GET /v1/matchmaking/{ticket}`; `DELETE /v1/matchmaking/{ticket}`; energy reserved and refunded on cancel/expiry.
- `GET /v1/matches/{id}`, `GET /v1/matches/{id}/replay`, `GET /v1/matches?leaderId=...`.
- `POST /v1/autobattle/activate|pause`, `GET /v1/autobattle/status|digest`.
- `GET /v1/tournaments`, `GET /v1/tournaments/{id}`, `POST /v1/tournaments/{id}/register`.
- `GET /v1/store/catalog`, `POST /v1/store/purchase`, `GET /v1/wallet`, `GET /v1/inventory`.

## Auth and actor model
`Leader` owns <=1 Agent at MVP, <=1 installedPolicyVersion, <=1 active queue ticket. Admin has distinct verified role. Public leaderboard/profile reads need privacy boundary. Every agent and match mutation authenticates server-side owner; arbitrary client-submitted `winner`, `AP`, `AC`, `energy`, `portraitUrl` forbidden.

## Metrics
Funnel completion by steps, Muse compile success and latency, mocked vs real counts, queue success/timeout, match execution latency/CPU, replay-checksum mismatch, AP settlement retries/dupes, AutoBattle lease renew rate, first ranked match and day-1 return, profile generation success/fallback, UI error rates. Strip sensitive prompts/PII from public telemetry.

## Technical Definition of Done
Lint + typecheck + unit + integration + browser E2E green; migration forward/back guidance; 1k seeded matches invariant tests; replay checksum across client/server; dual-concurrency settlement test; no unowned actions; backend IDs/cost guards; production health and basic telemetry; screenshot traces at 390, 768, 1440 widths.
