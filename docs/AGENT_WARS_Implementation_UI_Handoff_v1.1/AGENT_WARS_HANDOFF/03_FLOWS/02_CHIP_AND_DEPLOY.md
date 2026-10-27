# Core flow — Breed → Chip → Install → Deploy → Match → Results
## States and user-facing CTAs
`NO_AGENT` → BREED AGENT → `BORN_NO_CHIP` → CREATE CHIP → `CHIP_DRAFT` → COMPILE (Muse Spark) → `CHIP_VALIDATED` → INSTALL CHIP → `READY_TO_DEPLOY` → SELECT MODE → FIND MATCH → `QUEUED` → `MATCH_SETTLED` → RESULT/REPLAY → REVIEW/REPROGRAM or PLAY AGAIN.

### Breed
Account has zero agents; form contains name + birth concept + cosmetic tags. POST `/v1/agents` with idempotency key; image generation job async. Agent identity appears even if portrait pending. MVP exactly one agent; second creation is explicitly denied by server.
### Chip authoring
A chip is a named immutable version of a tactical policy, NOT a consumable power-up. User prompt example: 'Evade incoming projectiles and counterattack from long range'. UI shows 4 DNA traits + ordered executable rules and safety validation after compilation; label REAL MUSE or MOCK. Do not silently auto-install upon compile.
### Install
POST `/v1/agents/{agentId}/install` `{versionId, expectedCurrentVersionId, idemKey}`. Atomically ensures ownership, version belongs to agent, policy valid, and no forbidden editing while frozen tournament has snapshot. Set `active_version_id`; chips remain retrievable. MVP ONE slot/one installed chip; future modular multi-slot deferred. Illustrate physical animated socket/lock. INSTALL succeeds exactly once even if request repeated.
### Select and queue
Since MVP only one owned agent, agent selection shows one large selectable card preselected, not an empty fake roster. Future agents locked with explanatory text. Choose Training/Casual/Ranked; queue snapshot references installed version ID/hash. If no chip installed, disable Find Match with route to Agent Lab. Queue slot reservation idempotent; one active ticket per leader. Ranked can choose published opponent from offline roster (subject to eligibility and defense quota); do not require both web sessions.
### Automatic execution
Player press FIND MATCH; server pairs and runs canonical `battle-core`; after match result, client loads replay keyed by server matchId and checksum; visual is derived from replay state, never locally re-simulated using different tactics. Player can watch in realtime or afterwards; browser tab closing has no effect on settlement.
### Result
Correct mode-specific AP; show +12..+28 or -12..-28 if Ranked and winner/loser, AC award, tier change, next CTA Analyze / Watch / Queue Again. Clear Draw/No Contest cases and refunds.
### AutoBattle
Separate toggle: human authorizes autonomous scheduling for 24h from explicit activation. 10 max charges, 1 charge regen per 2h, backend controls scheduling; 1 charge consumed per MATCH START; sleep when empty or lease expired. On return display offline digest first, then REACTIVATE (not automatic), with installed policy and optional chip modification. Tournament matches independent from stamina/lease after registration.

## Non-negotiable UI states
Agent born but portrait pending; image generation failed; compiling; compile rejected; candidate valid but not installed; chip installed; queue searching; queue canceled/expired no energy spent; match executing while browser closed; replay loading; AP update pending; AutoBattle low energy; AutoBattle expired; tournament version frozen.

## QA walkthrough
Create fresh handle/auth account → birth agent → note identity/image and fallback → tactical prompt → compile valid chip → deliberately don't install and confirm cannot ranked queue → install → queue and close tab → reopen → result and replay match server → AP updates exactly once → activate AutoBattle → simulate 24h with injected clock → review digest and explicit reactivation. Mobile repeat.
