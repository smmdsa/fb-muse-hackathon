# Product decisions (binding)
- Browser-first PvP asynchronous autonomous 1v1 robot combat; humans author strategies, not joystick actions.
- One **Agent Leader** account; MVP allows one bred agent per account and exactly one active agent. Schema remains compatible with multi-agent later.
- One active **published policy version/chip loadout** per agent; revisions are immutable.
- Training (bot benchmark), Casual (unrated, same-MMR human first then bot after configurable 30s), Ranked (rated against registered leaders' eligible published agents, *including offline*; no bot farming AP). Spectator can replay/watch.
- AP displayed ranking tiers: PROTOTYPE 0–299, CIRCUIT 300–599, CORE 600–899, ASCENDANT 900–1199, each III=lowest, II=middle, I=highest; SINGULARITY >=1200 no subdivisions, leaderboard highest AP wins. New leader display default 500 AP with placements; confirm exact server placement rules.
- AP result delta = clamp(round(40 * (1 - expectedWinProbability)),12,28) for winner; loser equal negative; expected probability from pre-match internal rating (Elo expected formula 1/(1+10^((rOpponent-rSelf)/400))). Thus even rating +20/-20; favored by 200 ~+12/-12; 200-underdog win ~+28/-28. Draws/no-contests documented separately; no performance farming. AP floor 0; preserve zero-sum when neither at floor; floor breaks symmetry and must be explicit in test contract. Use server-only atomic idempotent settlement.
- Internal MMR is distinct from public AP; matchmaking should use MMR, not AP bands alone. Prevent self matching and repeated-pair farms. Handle idle/inactive offline eligibility explicitly.
- AutoBattle: max 10 scheduling charges, +1 charge every 2h (no money), spend on actually started automatic fight, 24h explicit authorization lease, expires to IDLE; manual return alone must NOT silently renew; player reviews results and clicks Reactivate. Player may spectate at any time. Pending queue should not burn a charge if no battle starts. Daily defense cap per GDD/code (currently 3/day) verified and surfaced.
- Tournament: organizer scheduled; free registration for MVP, eligibility snapshot, freeze policy version at lock, 8-agent bracket, finals BO3, public results. Tournament fights do not consume AutoBattle charges or require lease renewal after explicit registration. Premium tournament entry disabled pending legal review.
- Currency: AP never purchasable; AC earned and spent on basic cosmetics; RP simulated premium credits with NO purchases; ledger and idempotency; cosmetica never changes combat output.
- Season functionality is a later polish scope; maintain identity and AP history.

## Critical UX invariants
- 'Breed' creates avatar/identity, NOT a tactical policy. 'Compile chip' creates executable policy. 'Install' activates version. 'Deploy' enters the selected game mode. These are four visibly different steps.
- Do not place both editable prompt-vs-prompt local demo and authenticated Ranked in same primary CTA: segregate 'Sandbox' under Training/Developer demo.
- One ranked outcome has one authoritative event and one UI reward animation, including after refresh.
