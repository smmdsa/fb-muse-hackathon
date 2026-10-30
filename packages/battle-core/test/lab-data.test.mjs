import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ARENA_1V1,
  ARENA_FIRE_INTERVAL,
  ARENA_PICKUP_DMG_MULT,
  ARENA_PICKUP_DMG_SECS,
  ARENA_PICKUP_EVERY_TICKS,
  ARENA_PICKUP_FIRST_TICK,
  ARENA_PICKUP_HEAL,
  ARENA_PICKUP_MAX,
  ARENA_PICKUP_SHIELD_SECS,
  ARENA_RANGE,
  ARENA_SKILL_COOLDOWN,
  ARENA_SKILL_COST,
  ARENA_SKILL_DAMAGE,
  BOT_PRESETS,
  DASH_COOLDOWN,
  DASH_COST,
  DASH_MULT,
  SHIELD_ACTIVE,
  SHIELD_COOLDOWN,
  SHIELD_COST,
} from "../src/index.ts";

const html = readFileSync(new URL("../../../game/agent-wars/chip.html", import.meta.url), "utf8");
const chipJs = readFileSync(new URL("../../../game/agent-wars/chip.js", import.meta.url), "utf8");

describe("chip lab arena data", () => {
  it("states range, fire pace, and bot size from engine constants", () => {
    assert.ok(html.includes("Bot spans 1u wide."));
    assert.ok(html.includes(`Shots reach ${ARENA_RANGE}u.`));
    assert.ok(html.includes(`every ${ARENA_FIRE_INTERVAL}s`));
    assert.ok(html.includes("Target NONE holds fire and skill."));
  });

  it("states energy, dash, shield, and skill costs from engine constants", () => {
    assert.ok(html.includes(`Energy caps at ${ARENA_1V1.agent.maxEnergy} and regens ${ARENA_1V1.agent.energyRegen} per second.`));
    assert.ok(html.includes(`Dash costs ${DASH_COST} energy, boosts speed x${DASH_MULT} for the tick, and locks for ${DASH_COOLDOWN}s.`));
    assert.ok(html.includes(`Shield costs ${SHIELD_COST} energy, blocks all damage for ${SHIELD_ACTIVE}s, and locks for ${SHIELD_COOLDOWN}s.`));
    assert.ok(html.includes(`Skill fires one ${ARENA_SKILL_DAMAGE}-damage powered shot for ${ARENA_SKILL_COST} energy on a ${ARENA_SKILL_COOLDOWN}s lock and shares the ${ARENA_FIRE_INTERVAL}s fire window.`));
  });

  it("states the pickup clock and every pickup effect from engine constants", () => {
    const hz = ARENA_1V1.world.tickHz;
    assert.ok(html.includes(`First pickup spawns at ${ARENA_PICKUP_FIRST_TICK / hz}s, then one every ${ARENA_PICKUP_EVERY_TICKS / hz}s, at most ${ARENA_PICKUP_MAX} live.`));
    assert.ok(html.includes(`Green heals ${ARENA_PICKUP_HEAL} HP.`));
    assert.ok(html.includes(`Blue shields for ${ARENA_PICKUP_SHIELD_SECS}s.`));
    const pct = Math.round((ARENA_PICKUP_DMG_MULT - 1) * 100);
    assert.ok(html.includes(`Red adds ${pct}% damage for ${ARENA_PICKUP_DMG_SECS}s.`));
  });

  it("lists the exact arena operands, moves, and pickup codes", () => {
    const operands = [
      "ownHpPct", "energy", "distFoe", "projectileTti", "coverDist", "lineOfSight",
      "dashReady", "shieldReady", "objectiveDist", "timeLeft", "edgeDist",
      "foeHpPct", "gameTime", "foeAlive", "skillReady", "pickupDist", "pickupKind",
    ];
    for (const op of operands) assert.ok(html.includes(op), `lab lists operand ${op}`);
    const moves = ["APPROACH", "RETREAT", "STRAFE", "KITE", "CAPTURE", "SEEK_COVER", "WAIT", "COLLECT"];
    for (const move of moves) assert.ok(html.includes(move), `lab lists move ${move}`);
    assert.ok(html.includes("0 none, 1 green, 2 blue, 3 red"));
  });

  it("names every benchmark bot with its AP hint", () => {
    assert.ok(BOT_PRESETS.length >= 3);
    for (const bot of BOT_PRESETS) {
      assert.ok(html.includes(bot.name), `lab names ${bot.id}`);
      assert.ok(html.includes(String(bot.apHint)), `lab shows AP for ${bot.id}`);
    }
  });

  it("renders a skill column in the chip table", () => {
    assert.ok(chipJs.includes('"skill"'), "table headers name skill");
    assert.ok(chipJs.includes('c.skill ? "yes" : "no"'), "table cells show skill");
  });
});
