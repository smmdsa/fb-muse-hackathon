# Agent Wars MOBA Spec (v1.0)

Status: frozen for implementation. This doc fixes every number.
A later agent implements from this doc and invents no number.

Scope: one-lane ARAM-style 1v1 rework of the duel sim.
The duel sim stays intact. MOBA adds a new world and config.

Terms: F = user-frozen (never change). S = spec-fixed (this doc fixes it).
LoL = League of Legends. Unit = world unit. Tick = 1/30 s.

## 0. Frozen numbers

| # | Number | Value |
|---|--------|-------|
| F1 | Mode | One lane, ARAM-style 1v1 |
| F2 | Structures per side, own Nexus outward | Nexus, 2 Nexus turrets, inhibitor, tier-2 tower, tier-1 tower |
| F3 | Waves | Every 30 s from 1:00. 5 minions: 2 melee 200 HP, 3 casters 100 HP |
| F4 | Tower hit damage | 80 per hit |
| F5 | Robot start HP | 550 |
| F6 | Win | Destroy the enemy Nexus. No time limit. Clock counts UP from 0:00 |
| F7 | Gold | Melee minion 20, caster 14, enemy robot kill 300. Match gold lives ONLY in the sim. It resets per fight. AC wallet and post-match AC payouts stay untouched |
| F8 | Respawn cooldown | First death 12 s, then prev + prev/2 each death |
| F9 | Armor | Damage-reduction percent = Armor / (Armor + K), K = 100 |
| F10 | Shop categories | Damage, armor, move speed, attack speed, HP consumables. Cheap base items compose into bigger items |
| F11 | Buy | Agent policy decides buys as a discrete in-sim Buy action per tick. No backend shop endpoint. Frontend shows builds read-only from replay frames |

LoL sources: [turret stats](https://leagueoflegends.fandom.com/wiki/Turret),
[minions](https://leagueoflegends.fandom.com/wiki/Minion_(League_of_Legends)),
[armor](https://leagueoflegends.fandom.com/wiki/Armor),
[death timer](https://leagueoflegends.fandom.com/wiki/Death),
[turret aggro](https://www.nerfplz.com/2026/10/lol-turrets-explained-10-things-towers.html),
[item costs](https://op.gg/lol/classic/items).

## 1. Map geometry (S)

Keep height 16. Widen length to 48. The duel map cannot fit
5 structures per side with LoL spacing. LoL keeps each tower
outside the next tower range. 24 units cannot hold that.
48x16 holds it and keeps duel tuning (speed 4, tick 30 Hz,
projectile speed 14). Name: `mobaWorld`. `forgeWorld` stays.

Lane: straight line y = 8, from x = 2 to x = 46.
Side A (left) owns x < 24. Side B (right) mirrors x -> 48 - x.

### 1.1 Structure coordinates (center, radius)

| Structure | A coord | B coord | Radius |
|---|---|---|---|
| Nexus | (2.0, 8.0) | (46.0, 8.0) | 0.9 |
| Nexus turret top | (7.0, 6.4) | (41.0, 6.4) | 0.6 |
| Nexus turret bot | (7.0, 9.6) | (41.0, 9.6) | 0.6 |
| Inhibitor | (12.5, 8.0) | (35.5, 8.0) | 0.6 |
| Tier-2 tower | (17.5, 8.0) | (30.5, 8.0) | 0.6 |
| Tier-1 tower | (22.5, 8.0) | (25.5, 8.0) | 0.6 |

Lane spacing is 5.0 or more. Tower range is 4.8 (section 2).
A tower never covers a siege of the next tower outward.
A unit between two live towers eats both. That is a dive.

### 1.2 Spawns and waypoints

- Robot spawn: A (2.8, 8.0), B (45.2, 8.0).
- Minion spawn (d = +1 for A, -1 for B, nx = own Nexus x):
  melee at (nx + 0.8d, 7.5) and (nx + 0.8d, 8.5);
  casters at (nx + 0.1d, 7.3), (nx + 0.1d, 8.0), (nx + 0.1d, 8.7).
- Minion waypoints: [(24, 8), (enemy Nexus x, 8)].
- Minions stay in the lane band |y - 8| <= 2.5. If pushed out,
  they steer back to y = 8 before they advance.

### 1.3 Covers

Keep 4 covers as mid brush. The lane stays clear.

| Cover | Box |
|---|---|
| NW | min (19.5, 3.0), max (21.5, 5.0) |
| NE | min (26.5, 3.0), max (28.5, 5.0) |
| SW | min (19.5, 11.0), max (21.5, 13.0) |
| SE | min (26.5, 11.0), max (28.5, 13.0) |

Covers block movement, sight, and projectiles. Duel rules apply.

### 1.4 Collision

Structures are solid circles. Robots and minions push out of them.
Minions push out of each other (pairwise, ascending id order).
Robots push minions. Minions never push robots.
Map edge clamps all units. Radii: robot 0.35, minion 0.30.

## 2. Structures (S)

### 2.1 Stats

| Structure | HP | Armor | Range | Shot interval | Shot damage |
|---|---|---|---|---|---|
| Tier-1 tower | 1200 | 30 | 4.8 | 1.2 s | 80 (F4) |
| Tier-2 tower | 1500 | 30 | 4.8 | 1.2 s | 80 (F4) |
| Inhibitor | 800 | 30 | - | - | - |
| Nexus turret | 900 | 30 | 4.8 | 0.8 s | 80 (F4) |
| Nexus | 1200 | 30 | - | - | - |

Grounding: LoL towers carry 1850-2550 HP against ~600 HP
champions (ratio ~3-4). Here 1200-1500 against 550 HP robots.
LoL turret attack speed is 0.83/s outer, 1.25/s inhibitor,
2.5/s Nexus. Here 0.83/s (tier towers) and 1.25/s (Nexus turrets).
LoL ratio turret range / ADC range is ~1.4. Here 4.8 / 4.0 = 1.2.
Towers outrange robots, so robots cannot free-hit towers.

Nexus does not shoot. Inhibitor does not shoot.
The Nexus heals its owner: +4% max HP per second within 2.5 units.

### 2.2 Tower shots

Towers fire projectiles (speed 14, duel physics).
Armor reduces tower damage (LoL: turret shots are physical).
Shield blocks tower shots. Dash can dodge them.
Shots fizzle if the tower dies mid-flight (LoL rule).
Shots also fizzle past tower range 4.8 from their tower, so aimed
shots never cross the map to chip distant structures
(Amendment A3, see §15).
Tower shots never damage structures: turret aggro shots strike
units only (Amendment A4, see §15).

Heat (LoL ramp, compressed): each consecutive tower hit on the
same robot adds +25% damage, cap +100%. Heat resets when the
tower switches target or the robot leaves range for 2 s.
Math: 550 HP, 20 armor. Hits deal 67, 83, 100, 117, 133, 133 (66.7 x 1.0, 1.25, 1.5, 1.75, 2.0 cap).
The 6th hit kills. A tier-1 tower kills a full-HP robot in 7.2 s.
Dives die. That is the intent.

### 2.3 Tower targeting

Towers hold one target. Order per tick:

1. If the current target is alive and in range, keep it.
2. Else acquire: enemy minions in range by ascending id,
   then the enemy robot if in range.
3. Switch rule (LoL aggro): if the enemy robot deals damage to
   an allied robot within 6.5 units of the tower (trigger radius),
   and the enemy robot is in tower range, switch to it at once.
   LoL uses trigger 1400 vs range 775 (ratio 1.8). Here 6.5 / 4.8.
4. If several robots qualify, only one foe exists in 1v1. No tiebreak.

Towers never target structures. Towers ignore invulnerable units.

## 3. Robots (S)

### 3.1 Base stats

| Stat | Value | Note |
|---|---|---|
| Max HP | 550 | F5 |
| Attack damage | 20 | |
| Attack interval | 0.5 s | Duel FIRE_INTERVAL |
| Attack range | 4.0 | Towers outrange robots |
| Move speed | 4.0 | Duel speed |
| Radius | 0.35 | Duel radius |
| Armor | 20 | LoL champions start near 20-30 |
| Max energy | 100 | Duel |
| Energy regen | 8/s | Duel |
| Dash | cost 25, cooldown 3 s, mult 3.2 | Duel |
| Shield | cost 20, active 0.8 s, cooldown 4 s | Duel |

Keep energy, dash, and shield from the duel. Reasons: they are
the duel identity; chips already use them; dash dodges tower
shots and shield blocks them, so old skills transfer to MOBA.

Base DPS = 40. Time to kill a base robot (20 armor, mult 0.833):
550 / 33.3 = 16.5 s. LoL early TTK sits near 10-20 s. Good.

### 3.2 Robot attacks

Robot shots are projectiles (speed 14, duel physics).
Range check uses distance to target center minus target radius.
The driver picks the aim target (section 11.4).
Robots deal full damage to minions and robots.
Siege Breaker adds +50% against structures (section 6).

### 3.3 Death and kill credit

A robot-owned projectile that lands the last hit credits its owner.
Tower or minion kills grant no gold. The killer gains 300 gold (F7).
The victim deaths count rises by 1. Assists do not exist in 1v1.

## 4. Minions (S + F3)

### 4.1 Waves

First wave spawns at t = 60 s. Later waves spawn every 30 s (F3).
Both sides spawn at the same tick. Composition per wave (F3):
2 melee (200 HP), 3 casters (100 HP). No siege minion. No scaling.
Waves never stop until the match ends.

### 4.2 Stats

| Stat | Melee | Caster |
|---|---|---|
| Max HP | 200 (F3) | 100 (F3) |
| Attack damage | 12 | 16 |
| Attack interval | 1.0 s | 1.0 s |
| Attack range | 1.0 | 2.5 |
| Move speed | 3.0 | 3.0 |
| Radius | 0.30 | 0.30 |
| Armor | 0 | 0 |
| Aggro radius | 5.0 | 5.0 |
| Gold (F7) | 20 | 14 |

Grounding: LoL melee bounty is 21, caster ~14-17. LoL minion
move speed is 325 vs ~340 champion (ratio 0.96). Here 3.0 / 4.0
= 0.75, slower so waves read well on the small map.
Melee hits apply instantly. Casters fire projectiles (speed 14).
Minions deal x0.5 damage to structures (LoL: minions deal
reduced damage to structures, ~55%).

### 4.3 Minion AI

Each tick, per minion in ascending id order:

1. If the current target is valid (alive, in aggro radius for
   units, vulnerable for structures AND no enemy minion in aggro
   radius — Amendment A1, see §15), close to range and attack.
2. Else scan: nearest enemy minion in aggro radius, then nearest
   vulnerable enemy structure in aggro radius, then the enemy
   robot only by retaliation (rule 3). Ties break by id.
3. Retaliation: if the enemy robot damaged any allied unit within
   5.0 of this minion in the last 2 s, target the robot while it
   stays in aggro radius.
4. Else walk the waypoints (section 1.2).

No leash. Minions never retreat and never leave the lane band.
Symmetric waves stall at mid until robots intervene. That matches
ARAM: the wave freezes and champions break it.

## 5. Damage pipeline (S)

### 5.1 Armor

mult = 100 / (100 + Armor) for Armor >= 0 (F9).
No armor penetration exists, so Armor never drops below 0.
Final damage = raw x mult. HP stores exact floats. Replays round.

### 5.2 Tick phases (fixed order)

1. Clock, wave spawns, respawns due, Buy actions, auto-buy,
   auto-combines (recipe id order).
2. Movement: robot A, robot B, then minions by id.
3. Attacks: robots, towers (fixed structure order), minion
   casters (projectiles), minion melee (instant).
4. Projectiles move and collide in ascending id order.
5. Deaths resolve in ascending entity order. Gold and credit apply.
6. Structure destruction applies outward-in (section 5.3).
7. Win check (section 8). Tick increments.

### 5.3 Structure damage gating (no backdoor)

A structure takes damage only if the previous structure outward
is destroyed. Chain per side (outward to inward):

tier-1 -> tier-2 -> inhibitor -> Nexus turrets -> Nexus.

Rules:

- Each Nexus turret needs the inhibitor down. Either turret can
  fall first once the inhibitor is down.
- The Nexus needs at least one Nexus turret down (LoL rule).
- Invulnerable structures cannot be targeted. Projectiles pass
  through them and deal no damage.
- Destroyed inhibitor stays down for the whole match (F: recommended,
  this doc fixes it). Reason: no super-minion system exists in scope,
  so a respawn would add rules with no payoff.

## 6. Economy and items (S + F7, F10, F11)

### 6.1 Gold

Starting gold: 350. One base item plus a consumable. LoL starts
at 500 with the same buying power shape.
Gold sources are exactly F7: melee last hit 20, caster last hit 14,
robot kill 300. No passive income. No structure gold. No interest.
Only the last-hit robot earns minion gold. Minions earn nothing.

### 6.2 Item roster (15 items)

Stats stack additively. Percents stack additively, then apply once.

Base (buy any time, 6 slots max):

| Id | Name | Cost | Stats |
|---|---|---|---|
| scrap_blade | Scrap Blade | 250 | +8 AD |
| cloth_weave | Cloth Weave | 250 | +15 armor |
| worn_treads | Worn Treads | 250 | +0.4 move speed |
| overclock_chip | Overclock Chip | 300 | +15% attack speed |
| hull_patch | Hull Patch | 300 | +100 max HP |
| repair_cell | Repair Cell | 50 | Consumable: heal 120 now |

Tier 2 (combine from base + fee):

| Id | Name | Recipe | Fee | Total | Stats (replace parts) |
|---|---|---|---|---|---|
| tempered_edge | Tempered Edge | scrap_blade | 350 | 600 | +18 AD |
| bulwark_plate | Bulwark Plate | cloth_weave | 350 | 600 | +35 armor |
| turbo_treads | Turbo Treads | worn_treads | 350 | 600 | +0.9 move speed |
| rapid_cycler | Rapid Cycler | overclock_chip | 350 | 650 | +35% attack speed |
| reinforced_hull | Reinforced Hull | hull_patch | 350 | 650 | +250 max HP |

Tier 3 (combine from tier 2 + fee):

| Id | Name | Recipe | Fee | Total | Stats (replace parts) |
|---|---|---|---|---|---|
| siege_breaker | Siege Breaker | tempered_edge + rapid_cycler | 400 | 1650 | +35 AD, +30% AS, Demolish (+50% vs structures) |
| aegis_core | Aegis Core | bulwark_plate + reinforced_hull | 400 | 1650 | +70 armor, +400 max HP |
| phantom_drive | Phantom Drive | turbo_treads + rapid_cycler | 400 | 1650 | +1.0 move speed, +50% AS |
| warlord_frame | Warlord Frame | tempered_edge + reinforced_hull | 400 | 1650 | +25 AD, +450 max HP |

Grounding: LoL base items cost 300-475 (Long Sword 10 AD,
Cloth Armor 15 armor, Dagger 12% AS, Ruby Crystal 150-180 HP,
Boots +25 MS, potion 50 for 150 HP). This roster mirrors those
prices and stat shapes at MOBA income (~82 gold per full wave).

### 6.3 Composition tree

```text
scrap_blade (250) -+-> tempered_edge (+350) -+-> siege_breaker (+400)
                   |                          |
overclock_chip (300) -> rapid_cycler (+350) -+  |
                     |                          |
                     +--------------------------+-> phantom_drive (+400)
                     |                          |
worn_treads (250) --> turbo_treads (+350) ------+
cloth_weave (250) --> bulwark_plate (+350) -+-> aegis_core (+400)
                                                |
hull_patch (300) --> reinforced_hull (+350) -+  |
                     |                          |
                     +--------------------------+-> warlord_frame (+400)
                                                |
tempered_edge ------ (shared, see order) -------+

repair_cell (50): consumable, no slot, heals on buy.
```

`rapid_cycler` feeds two recipes and `tempered_edge` feeds two.
Recipe order resolves ties: siege_breaker < aegis_core <
phantom_drive < warlord_frame. The first matchable recipe wins.

### 6.4 Caps and application

- Attack speed: interval = 0.5 / (1 + bonus). Floor 0.25 s.
- Move speed: cap 7.0.
- Armor: no cap. The formula self-limits.
- Max HP gain heals the same amount at once (buy and combine).
- Consumables apply on buy and use no slot. No consumable inventory.

### 6.5 Buy action semantics (F11)

`AgentAction` gains `buy: string | null` (item id or null).
One buy per robot per tick. Rules:

1. `buy: null` means no buy.
2. Buy names any item id, any tier. The sim auto-buys missing
   parts plus the fee if total cost fits current gold and a slot
   is free. Else the buy is a no-op (never partial).
3. Consumables apply at once and need no slot.
4. Combines also run free at tick end (phase 1): if a robot holds
   all parts of a recipe and holds fee gold, the sim combines at
   once, in recipe id order. No Buy action needed.
5. Buys work anywhere. No shop zone. The robot is the fabricator.
   This keeps the policy surface small and deterministic.
6. Each buy emits a replay event (section 9).

### 6.6 Auto-buy fallback (ON by default)

Auto-buy runs every 30 ticks when `autoBuy` is true (default true)
and the policy issued no Buy that tick. Priority:

1. If hpPct < 50 and gold >= 50, buy repair_cell. Stop at hpPct >= 80.
2. Else buy the cheapest missing base item in fixed order:
   scrap_blade, cloth_weave, overclock_chip, hull_patch, worn_treads.
   Skip owned or combined-away parts. Skip if gold falls short (save).
3. Else save. Tick-end combines still spend fees on their own.

Auto-buy never buys tier 2 or 3 directly. Combines build them.
A policy beats auto-buy by buying itself or by saving with a plan.

## 7. Respawn (S + F8)

Cooldown for death n (n starts at 1):

cooldown(n) = min(60, round(12 x 1.5^(n-1))). Halves round up.

| Death | Exact | Cooldown |
|---|---|---|
| 1 | 12 | 12 s |
| 2 | 18 | 18 s |
| 3 | 27 | 27 s |
| 4 | 40.5 | 41 s |
| 5 | 60.75 | 60 s (cap) |
| 6+ | - | 60 s (cap) |

The 60 s cap mirrors LoL (death timers cap near 52-60 s).
Respawn state: own robot spawn (section 1.2), full HP, full energy,
kept gold and items, kept deaths count. Cooldowns reset.
Spawn shield: immune to damage for 2 s after respawn. The robot
can move, attack, and buy during the shield. The shield shows in
replay frames (`shield` ticks left).

## 8. Win, clock, safety cap (S + F6)

- Win: destroy the enemy Nexus. The tick the Nexus HP hits 0,
  the match ends at once. Winner = the other side.
- No battle time limit (F6). The clock counts UP from 0:00.
  `timeLeft` still exists for chips: cap minus time (section 11).
- Safety cap: 1800 s (30 min) = 54000 ticks. Very high, per the
  brief. It only stops runaway sims, never decides real matches.
- Tiebreak at cap, in order:
  1. More enemy structures destroyed wins.
     Each structure counts 1 (6 per side max, Nexus excluded
     since the match would have ended).
  2. More lifetime gold earned wins (all sources, both sides tracked).
  3. Else DRAW.

## 9. Replay v2 schema (S)

Versioned. v1 readers reject v2 by `version` and `mode` fields.

```jsonc
{
  "version": 2,
  "mode": "moba",
  "seed": "forge-001",
  "winner": "A",
  "ticks": 12345,
  "timeSec": 411.5,
  "checksum": "fnv1a-hex",
  "structures": ["a_t1", "a_t2", "a_inhib", "a_nt_top", "a_nt_bot", "a_nexus",
                 "b_t1", "b_t2", "b_inhib", "b_nt_top", "b_nt_bot", "b_nexus"],
  "frames": [
    {
      "t": 0,
      "a": {"x": 2.8, "y": 8.0, "hp": 550, "en": 100, "gold": 350,
            "alive": true, "respawn": 0, "shield": 0, "items": []},
      "b": {"x": 45.2, "y": 8.0, "hp": 550, "en": 100, "gold": 350,
            "alive": true, "respawn": 0, "shield": 0, "items": []},
      "minions": [{"id": 1, "side": "A", "kind": "melee", "x": 3.0, "y": 7.5, "hp": 200}],
      "structs": [1200, 1500, 800, 900, 900, 1200, 1200, 1500, 800, 900, 900, 1200],
      "builds": null
    }
  ],
  "events": [
    {"t": 1800, "type": "wave", "side": "A"},
    {"t": 1900, "type": "buy", "side": "A", "item": "scrap_blade", "gold": 100},
    {"t": 2100, "type": "combine", "side": "A", "item": "tempered_edge"},
    {"t": 5400, "type": "kill", "side": "B"},
    {"t": 5430, "type": "respawn", "side": "B"},
    {"t": 9000, "type": "structure", "side": "A", "id": "b_t1"}
  ]
}
```

Rules:

- Cadence: one frame every 9 ticks plus frame 0 and the final frame.
  Same cadence as v1.
- Numbers: positions round to 2 decimals. HP, gold, energy round
  down to int. Ticks are ints.
- `minions`: live minions only, ascending id. Capped in practice
  near 20 (two full waves clashing). No hard cap; sims never pile
  more because waves annihilate.
- `structs`: full HP array every 10th frame AND on any frame where
  a value changed. Else `null`. Order follows `structures`.
- `builds`: per-side item id arrays, only on frames where a build
  changed. Else `null`. Robot `items` in frames: same rule, but the
  example shows shape. To save space, `a.items`/`b.items` appear only
  on build-change frames; readers carry the last build forward.
- Events: `wave` (both sides, one event per side), `buy`
  (with gold left), `combine`, `kill` (robot died; `side` = victim),
  `respawn`, `structure` (`id` from `structures`, `side` = owner).
  Minion deaths emit no events. Size control.
- Frontend renders frames and events. It never re-simulates (F11).

Size budget: typical match 5-10 min = 1000-2000 frames.
Typical frame ~450 bytes (2 robots, ~10 minions, rare struct
deltas). Typical fight lands under ~1 MB. Acceptance check:
seed the balance fixtures (section 12), build the replay, assert
JSON byte length < 1,048,576.

## 10. Determinism (S)

1. Seeded RNG only. `rng.ts` (xmur3/mulberry32/fnv1a) is the only
   randomness allowed. MOBA needs almost no draws; minion spawn
   jitter is zero (fixed offsets). Any future draw uses the seed
   stream in fixed call order.
2. Stable iteration: robots A then B; minions by ascending id;
   towers in `structures` order; projectiles by ascending id.
3. No wall-clock. No `Date.now` in the sim. Time derives from tick.
4. Float policy: sim keeps full floats. `stateKey` rounds with
   `toFixed(4)` (duel rule). No `Math.random`, no object-key order
   dependence.
5. `checksum`/`stateKey` cover all new state: tick, both robots
   (pos, hp, energy, gold, items, cooldowns, deaths, respawn timer),
   minions (id, side, kind, pos, hp, target), structures HP,
   projectiles (id, pos), lifetime gold per side.
6. Same seed + same policies = byte-identical replay and checksum.
   The API replay route re-simulates and compares checksums (duel
   contract, unchanged).

## 11. Policy and chip surface (for the ai-engineer) (S)

### 11.1 Schema

`schemaVersion: 2`. v1 policies stay valid: missing `buy` means
null, missing operands default safe, auto-buy covers the economy.
New optional rule field: `buy?: string` (item id from section 6.2).
Unknown item ids fail validation. One buy per tick per robot.

### 11.2 New observation operands

All 12 v1 operands stay. MOBA redefines two:

- `objectiveDist`: distance to the nearest vulnerable enemy
  structure (was: map center). CAPTURE follows it (section 11.3).
- `timeLeft`: 1800 - time (was: duel cap minus time).

New operands (all numbers; null reads fail closed per `evaluate`):

| Operand | Meaning |
|---|---|
| ownGold | Current match gold |
| ownDeaths | Death count this match |
| gameTime | Seconds since 0:00 (counts up) |
| distFoeTower | Distance to nearest vulnerable enemy structure |
| foeTowerHpPct | Its HP percent (null if none vulnerable) |
| nearFoeMinions | Enemy minion count within 6.0 |
| nearAllyMinions | Allied minion count within 6.0 |
| distFoeMinion | Distance to nearest enemy minion (null if none live) |
| foeHpPct | Foe robot HP percent, LoS-gated like distFoe |
| buildValue | Total gold spent on items + combine fees |
| slotsFree | Free item slots (6 max) |
| structLead | Own alive structures minus foe alive structures |

### 11.3 New move intents

All 6 v1 intents stay. CAPTURE moves toward the nearest vulnerable
enemy structure in MOBA mode. New intents:

| Intent | Driver behavior |
|---|---|
| PUSH | Move along the lane toward the enemy Nexus, capped at own minion front + 1.0 (never outrun the wave) |
| FARM | Move toward the nearest enemy minion with HP below one robot shot; else nearest enemy minion |
| DEFEND | Move toward the most threatened own structure (enemy minions in 6.0, innermost first); else nearest own tower |

### 11.4 Target selection (driver, when `fire: true`)

The driver sets `aim` each tick. Priority in range + LoS:

1. Enemy minion with HP below one robot shot (last-hit), nearest.
2. Enemy robot, if in range.
3. Nearest enemy minion in range.
4. Nearest vulnerable enemy structure in range.
5. Else aim along move (no target, projectile still fires).

LoS uses covers (duel rule). Structures are always visible.
This keeps old chips useful: `fire: true` now last-hits, duels,
pushes, and sieges without new chip flags.

### 11.5 Bots and benchmark

Port BOT_PRESETS and BENCH_POLICY to schema v2. Keep their
personalities (shadow kites, bench balances, breaker rushes).
Add one buy rule each (e.g. shadow buys cloth_weave first).
Add one PUSH/FARM rule each so bots leave mid. Exact rules are
the ai-engineer task; acceptance checks sit in section 12.

## 12. Balance targets and acceptance checks (S)

Targets: typical match lasts 5-10 min sim time. Tier-1 never
falls before 2:30. Tower dives kill the diver (section 2.2 math).
A full-tier-3 robot kills a naked robot in under 5 s.
Minion-only waves stall near mid (no structure falls by 5:00
with both robots parked at spawn).

Checks per downstream task. Each check names pass/fail.

T1 battle-core sim:

- [ ] T1.1 Gating: scripted foe ignores t1 and hits t2. t2 HP
  stays full. Then t1 falls and t2 takes damage. Pass = both hold.
- [ ] T1.2 Nexus rule: with inhibitor down and both Nexus turrets
  up, Nexus HP stays full under fire. One turret falls, Nexus
  takes damage. Pass = both hold.
- [ ] T1.3 Tower aggro: scripted robot A hits robot B inside tower
  trigger. Tower switches to A within 1 tick. Pass = target flips.
- [ ] T1.4 Heat math: naked robot tanks tier-1 from full HP.
  Dead on the 6th hit. Pass = death tick within 6.5-7.5 s.
- [ ] T1.5 Respawn table: kill a robot 5 times. Cooldowns read
  12, 18, 27, 41, 60 s. Pass = exact match.
- [ ] T1.6 Determinism: fixed seeds x fixed policies, run twice.
  Byte-identical replay JSON and checksum. Pass = `diff` empty.
- [ ] T1.7 Cap tiebreak: force 1800 s with rigged structure counts.
  Winner follows section 8 order. Pass = 3/3 fixtures.
- [ ] T1.8 Buy no-op: buy tier-3 with 0 gold. Gold, items unchanged,
  no event. Pass = silent no-op.

T2 behavior-dna and policy driver:

- [ ] T2.1 v1 compat: BENCH_POLICY v1 runs a MOBA fight to the end
  with no throw. Auto-buy owns at least 1 item by 5:00. Pass = both.
- [ ] T2.2 Operands: each new operand reads the documented value
  on a scripted state. Pass = 12/12 exact.
- [ ] T2.3 Intents: PUSH never passes the minion front; FARM moves
  toward the lowest-HP enemy minion; DEFEND moves toward the
  threatened tower. Pass = 3/3 scripted probes.
- [ ] T2.4 Last-hit aim: with a 15 HP caster and full minions in
  range, aim picks the 15 HP caster. Pass = exact target.
- [ ] T2.5 Buy validation: unknown item id fails `validatePolicy`.
  Pass = error names the id.

T3 api and worker:

- [ ] T3.1 Match row stores v2 checksum. Replay route re-simulates
  and reports identical. Pass = `identical: true`.
- [ ] T3.2 AC payouts unchanged: win/loss/no-contest amounts match
  duel code paths. Match gold never touches the wallet. Pass = diff
  of payout code is empty (or covered by existing tests).
- [ ] T3.3 Ranked/AP settle path runs on a MOBA result. Pass = one
  ranked fixture settles with correct deltas.

T4 frontend viewer:

- [ ] T4.1 `window.playServerReplay` plays a v2 replay: minions,
  structures with HP bars, gold, builds read-only. Pass = scripted
  DOM check on a fixture replay.
- [ ] T4.2 No re-simulation: viewer imports no battle-core sim
  module. Pass = grep finds no step/create import in viewer code.
- [ ] T4.3 Size: fixture replays render first frame in under 1 s
  on a Nomad baseline. Pass = timed probe.

T5 balance pass:

- [ ] T5.1 Bench vs bench ends in 5-10 min sim time. Pass = ticks
  in [9000, 18000].
- [ ] T5.2 Both tier-1 towers stand at 2:30 in bench vs bench. Pass = both alive.
- [ ] T5.3 Replay JSON of the T5.1 fight is under 1 MB. Pass = bytes.
- [ ] T5.4 Minion-only stall: parked robots, no structure falls by
  5:00. Pass = all struct HP full (chip damage allowed under 5%).

## 13. Out of scope

No XP or levels. No siege or super minions. No minion scaling.
No second lane and no jungle camps. No wards or fog beyond cover
LoS. No recalls or teleports. No backend shop endpoint (F11).
No AC cost for items. No armor penetration or lethality.
No critical strikes. No cooldown-reduction stat.
The duel mode keeps all old numbers and stays playable.

## 14. Config wiring (S)

- `BattleConfig` gains `mode: "duel" | "moba"` (default `"duel"`).
  Duel defaults stay byte-identical. MOBA sets `world: mobaWorld()`,
  `mode: "moba"`, `autoBuy: true`, plus this spec constants.
- `fightPolicies`, `buildReplay`, `checksum`, `stateKey` take the
  config through. The matches table stores the v2 checksum as today.
- `game/agent-wars/game.js` mirrors the duel only. A MOBA sandbox
  mirror is out of scope for this rework.

## 15. Amendments

- A1 (minion structure stickiness): §4.3 rule 1 gains "AND no
  enemy minion in aggro radius" for structure targets. Cause:
  frozen geometry (t1 1.5 from mid, aggro 5.0) let wave
  vanguards acquire towers before enemy minions entered aggro,
  so waves walked past each other and melted both tier-1s by
  5:00 with parked robots (T5.4). The amendment reuses aggro
  5.0 and invents no number; waves now clash at mid as §4
  specifies.
- A3 (tower shot range): §2.2 gains fizzle past range 4.8.
  Cause: tower projectiles flew until wall/hit and crossed
  11 units to chip the enemy tier-1 (~61.5 per shot), which
  alone exceeded the T5.4 5% budget in the parked-robots
  stall. Reuses range 4.8, invents no number.
- A4 (tower shots vs structures): tower projectiles skip the
  structure collision branch. Cause: tier-1 towers stand 3.0
  apart, so a shot whose minion target died mid-flight kept
  flying into the adjacent enemy tower (~61.5 per shot), which
  alone broke the T5.4 stall. Turret aggro shots now strike
  units only (LoL rule). Reuses the existing kinds, invents
  no number.


