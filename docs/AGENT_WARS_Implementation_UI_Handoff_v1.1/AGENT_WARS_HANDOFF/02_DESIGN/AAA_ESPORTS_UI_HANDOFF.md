# AAA Esports UI Handoff — AGENT WARS
## North star
Premium esports platform, dark tactical command center, not a landing page, debug dashboard or casino. Every screen should communicate a player identity, active agent, rank, next action and meaningful battle context. AAA refers to craft and polish, not expensive 3D assets: cohesive, legible, responsive, cinematic but performance-aware.

## Art direction
**Theme:** post-industrial robotics sports league. Dark graphite/near-black steel panels, precision cyan telemetry, orange/red combat threat, gold achievement. Restrained geometry and fine hairline grids, no indiscriminate neon glows, glassmorphism soup, purple gradients, cartoon stock AI robots, unmotivated giant empty spaces. Large bold condensed title faces (Chakra Petch for display if licensed/available), neutral readable interface face (Inter/system). Use uppercase sparingly on nav/HUD.

## Tokens (initial design system)
- `bg.canvas #090E16`; `bg.panel #111B27`; `bg.raised #192534`; `bg.hover #223447`; `border #334657`.
- `text.primary #F1F5FA`; `text.secondary #9BAEC0`; `text.muted #698096`; `brand.cyan #42D9EC`; `brand.cyanHover #8BF3FF`; `warning #E5B45A`; `danger #F27565`; `success #58D5A7`; `elite #B79AF6`.
- 8px base spatial grid; radii 8 / 12 / 16; button height 44 desktop / 48 touch; interaction hit target >=44px; focus ring 2px cyan with offset; transitions 120–200ms; result reveals up to 450ms. Respect reduced motion. 4.5:1 contrast body text.
- Desktop content max 1600px, fixed sidebar 224px (collapsible to 72), header 64px, dashboard cards 12-col layout, gap 16/24, modal width <=640, drawer 420. Battle stage target 16:10 or 3:2, preserve full arena and HUD.
- 1024px tablet: collapsible nav / stacked secondary panels; <=768px: 56px top + bottom navigation (Play, Agent, Events, Profile), critical CTAs sticky; 390px minimum design. No horizontal scroll for forms; hero image ratio stable; no clipped event brackets (use explicit horizontal pan and minimap).

## IA / Navigation hierarchy
Left nav: COMMAND (Home), ARENA (Play), AGENT LAB (Breed / Chips), RANKED (Standings), CHAMPIONSHIPS (Events), ARMORY (Shop), PROFILE. Header: season badge, AP tier crest, AC/RP balances, connection status, avatar. Mobile priority: Play / Agent / Championships / Profile, more drawer for others.

## Screen-by-screen layout and behavior
### 1. Welcome / Login / First Run
Full bleed branded arena key art on desktop (text readable overlay), one compelling line: 'Build the brain. Enter the arena.' Single login CTA; honest guest sandbox; first-time 3-step progress (Breed > Program > Deploy), skip fluff. Authenticate before persistent data; handle unavailable errors. Do not use handle-only token guessing in production.
### 2. COMMAND lobby (post-login)
Above fold: 60% agent hero art and summary (name, DNA class, live status, installed chip), 40% Rank progress (crest, AP, ± previous), AutoBattle energy + 24h lease, dominant 'PLAY RANKED'. Under fold: recent match with replay, battle report summary, event countdown, mini leaderboard, AC wallet. Distinguish disabled state when chip not installed with 'INSTALL CHIP' action.
### 3. BREED STATION
Left: form name (3–24 chars), birth-concept prompt (max 280), style variant tags (silhouette, temperament, accent chosen as cosmetic guidance only), seed controls optional. Center: 1:1 agent portrait card fixed visual frame, placeholder and build progress. Right: 'Your genome': fixed non-stat species shell + cosmetic variation + agent identity. CTA 'BREED AGENT' with generation progress stages; success → 'Program your first chip'. No hidden stat buffs, no unlimited free regeneration; retry/backoff, job statuses, fallback silhouette on provider failure. One created agent MVP; preventing second breed is explicit. Add prompt examples; sanitize input and moderation.
### 4. CHIP WORKBENCH (Agent Lab)
Visual metaphor of cartridge/chip installed in clearly labeled core socket. Prompt to tactics distinct from birth concept. Left text input + tactical presets and four DNA sliders. Center preview chip summary (priority rules, behavior, legal actions, provider live/mock). Right agent preview + slot: EMPTY / CANDIDATE / INSTALLED, version history below. Actions: COMPILE → validate → compare to installed → INSTALL (explicit) → TRAIN (optional) → DEPLOY. Compiling never silently changes the active Ranked policy. Show compile credits/rate limits and validation reasons.
### 5. ARENA lobby and queue
Hero agent card + installed chip + tier, choose TRAINING / CASUAL / RANKED, match settings supported by selected mode. START MATCH queues single selected agent and freezes a snapshot version. Queue panel status 'searching', opponent conditions, elapsed, cancel; energy RESERVED not spent until match begins; timeout refunds reservation. When match accepted, transition to ARENA VIEWER from server match record. No second local-only fight presented as Ranked.
### 6. LIVE / REPLAY ARENA
Center battle canvas 70% width, side live telemetry (HP, shields, energy, event timeline, current tactic) 30%; top scoreboard, phase, timer, seed/match ID, badge REPLAY/LIVE. Event feed collapsible on mobile. Controls play/pause, 1x/2x/4x and seek if replay snapshots available. Instant hit feedback, shield block VFX, dash trail, cover hit effects, uncluttered line-of-sight. Server result authoritative; users cannot influence outcome through client controls. Performance 60fps render target; sim fixed 30 Hz.
### 7. RESULT / RANKED progression
Outcome headline, AP delta (20 base adjusted 12–28), opponent rating context, division animation, before/after crest, AC earned, battle metrics and clear WATCH REPLAY / ANALYZE / REMATCH (new legal queue) CTAs. Draw/no contest handled. Never announce AP if a training or casual fight.
### 8. AUTOBATTLE operations
Show ACTIVE / IN_MATCH / IDLE_ENERGY / IDLE_LEASE / PAUSED / TOURNAMENT_LOCKED statuses, 10 charge meter, next charge countdown, 24h remaining with explicit 'REACTIVATE' after reviewing overnight digest. Journal sortable per day: matches, wins/losses, AP changes, AC, installed policy version, anomalies. Watching battle never renews lease automatically.
### 9. CHAMPIONSHIPS
Cards of UPCOMING / OPEN / LOCKED / LIVE / COMPLETE, dates in local TZ and UTC, slots, AP requirement, free fee, prizes. Event detail: hero banner, rules, registration check, selected immutable agent version, joined status, participants, timeline, horizontally scrollable bracket with round names + match replays. Organization-only event authoring kept in secure /admin route, not general client.
### 10. RANKED + LEADERBOARD
Large personal crest and AP, 12 divisions plus Singularity no division, season/top leaderboard, sort only server-driven, user-row highlighting, links to player profiles. Empty placements handled.
### 11. ARMORY
AC/RP separated, cosmetics preview on agent (no damage changes), locked premium checkout, mock-only RP indicator and purchase confirm, cosmetics inventory + equip flows; accessible receipts and no real-money input.

## Shared interactive components
`AppShell`, `SidebarNav`, `TopBar`, `AgentHeroCard`, `RankCrest`, `APProgress`, `DNAStatBar`, `ChipCard`, `ChipSocket`, `ActionButton`, `BattleStage`, `MatchTicket`, `StaminaMeter`, `LeaseTimer`, `MatchHistoryRow`, `ReplayControls`, `TournamentCard`, `BracketGrid`, `CurrencyBalance`, `ShopItemCard`, `Toast`, `Modal`, `ErrorBoundary`, `Skeleton`, `EmptyState`.
Every async UI component must define: loading, success, validation error, network failure, offline/disconnected, unauthorized, empty, retry, and stale data. No fake buttons.

## Visual motion and sound
UI selection click, queue lock-in, chip install mechanically snaps and glow settles; ready swoosh, league ascension banner, win/loss animations, reduced-motion static alternatives. Sounds muted by default on initial browser session, accessible toggle; no autoplay audio. Battle hit flash <120ms, no full-screen seizure-prone effects.

## UI acceptance
At 1440x900 home has agent hero, primary Play CTA, rank and AutoBattle above fold. At 390x844 user completes breed, compile, install and queue with one thumb; no horizontal scrolling except explicit bracket. UI state always reflects backend state; all nav links routed; keyboard usable; no broken images; fallback assets; Lighthouse accessible contrast; 60fps renderer on reasonable desktop, 30fps acceptable low-end mobile. Screenshots approved at desktop/tablet/mobile for every key flow.
