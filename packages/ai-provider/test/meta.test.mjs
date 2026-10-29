import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMetaProvider, portraitFromEnv } from "../src/index.ts";

const POLICY_TEXT = JSON.stringify({
  schemaVersion: 1,
  agentVersionId: "v9",
  dna: { aggression: 80, evasion: 40, preferredDistance: 25, energyConservation: 50 },
  rules: [
    { id: "close-fire", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
    { id: "weak-retreat", when: { operand: "ownHpPct", op: "lt", value: 25 }, move: "RETREAT" },
  ],
});

const chatOk = (text) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: text } }], usage: { total_tokens: 120 } }),
});

describe("meta provider", () => {
  it("compiles a valid draft from a chat reply", async () => {
    const seen = [];
    const fetchFn = async (url, init) => {
      seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return chatOk(POLICY_TEXT)();
    };
    const meta = createMetaProvider({ META_SPARK_KEY: "spark-k" }, fetchFn);
    const out = await meta.compileStrategy({ prompt: "rush them down", agentVersionId: "v9" });
    assert.equal(out.provider, "meta");
    assert.equal(out.isMock, false);
    assert.equal(out.policy.schemaVersion, 2);
    assert.equal(out.policy.dna.aggression, 80);
    assert.equal(out.promptTokens, 120);
    assert.match(seen[0].url, /\/chat\/completions$/);
    assert.equal(seen[0].body.model, "muse-spark-1.3");
    assert.equal(seen[0].headers.authorization, "Bearer spark-k");
    assert.equal(seen[0].body.reasoning_effort, "low");
  });

  it("sends the full operand, operator, and move vocabulary", async () => {
    let system = "";
    const fetchFn = async (url, init) => {
      system = JSON.parse(init.body).messages.find((m) => m.role === "system").content;
      return chatOk(POLICY_TEXT)();
    };
    const meta = createMetaProvider({ META_SPARK_KEY: "spark-k" }, fetchFn);
    await meta.compileStrategy({ prompt: "rush", agentVersionId: "v9" });
    for (const token of ["ownHpPct", "distFoe", "projectileTti", "coverDist", "lineOfSight", "dashReady", "shieldReady", "foeLastSeenAge", "objectiveDist", "timeLeft", "edgeDist", "energy", "paragraphs long"]) {
      assert.ok(system.includes(token), `system names operand ${token}`);
    }
    for (const token of ["gt, gte, lt, lte, eq", "APPROACH", "RETREAT", "STRAFE", "KITE", "CAPTURE", "SEEK_COVER", "rejects the whole draft"]) {
      assert.ok(system.includes(token), `system names ${token}`);
    }
    for (const token of ["ownGold", "nearFoeMinions", "nearAllyMinions", "distFoeTower", "foeTowerHpPct", "buildValue", "PUSH", "FARM", "DEFEND", "auto-attack", "scrap_blade", "siege_breaker", "schemaVersion\":2"]) {
      assert.ok(system.includes(token), `system names moba token ${token}`);
    }
  });

  it("refuses a keyless compile without calling the network", async () => {
    let called = 0;
    const meta = createMetaProvider({}, async () => { called += 1; return chatOk(POLICY_TEXT)(); });
    const out = await meta.compileStrategy({ prompt: "rush", agentVersionId: "v9" });
    assert.equal(out.policy, null);
    assert.equal(called, 0);
    assert.match(out.errors[0], /META_SPARK_KEY/);
  });

  it("carries the image key alone on portrait calls", async () => {
    const seen = [];
    const fetchFn = async (url, init) => {
      seen.push({ headers: init.headers });
      return { ok: true, status: 200, json: async () => ({ data: [{ url: "https://cdn.example/p.png" }] }) };
    };
    const meta = createMetaProvider({ META_SPARK_KEY: "s", META_IMAGE_KEY: "i" }, fetchFn);
    await meta.generatePortrait({ prompt: "chrome wasp" });
    assert.equal(seen[0].headers.authorization, "Bearer i");
  });

  it("repairs a bad draft once before it gives up", async () => {
    const bad = JSON.stringify({
      schemaVersion: 1,
      agentVersionId: "v9",
      dna: { aggression: 500, evasion: 40, preferredDistance: 25, energyConservation: 50 },
      rules: [
        { id: "close-fire", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
      ],
    });
    const meta = createMetaProvider({ META_SPARK_KEY: "s", META_IMAGE_KEY: "i" }, chatOk(bad));
    const out = await meta.compileStrategy({ prompt: "rush", agentVersionId: "v9" });
    assert.equal(out.repairAttempted, true);
    assert.equal(out.policy.dna.aggression, 100);
  });

  it("fails honestly on non-JSON and on HTTP errors", async () => {
    const notJson = createMetaProvider({ META_SPARK_KEY: "s", META_IMAGE_KEY: "i" }, chatOk("hello"));
    const a = await notJson.compileStrategy({ prompt: "rush", agentVersionId: "v9" });
    assert.equal(a.policy, null);
    assert.ok(a.errors.length > 0);

    const down = createMetaProvider({ META_SPARK_KEY: "s", META_IMAGE_KEY: "i" }, async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const b = await down.compileStrategy({ prompt: "rush", agentVersionId: "v9" });
    assert.equal(b.policy, null);
    assert.match(b.errors[0], /status 500/);
  });

  it("generates a portrait through the image endpoint", async () => {
    const seen = [];
    const fetchFn = async (url, init) => {
      seen.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ data: [{ url: "https://cdn.example/p1.png" }] }) };
    };
    const meta = createMetaProvider({ META_SPARK_KEY: "s", META_IMAGE_KEY: "i" }, fetchFn);
    const out = await meta.generatePortrait({ prompt: "chrome wasp robot, cyan visor" });
    assert.equal(out.url, "https://cdn.example/p1.png");
    assert.equal(out.model, "muse-image-1.0");
    assert.match(seen[0].url, /\/images\/generations$/);
  });

  it("refuses portraits without a key", () => {
    assert.throws(() => portraitFromEnv({}), /META_IMAGE_KEY/);
  });

  it("reads inline b64_json the way Meta answers", async () => {
    const webp = "UklGRtaAAAAA" + "A".repeat(40);
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ created: 1793137810, data: [{ b64_json: webp }] }) });
    const meta = createMetaProvider({ META_SPARK_KEY: "s", META_IMAGE_KEY: "i" }, fetchFn);
    const out = await meta.generatePortrait({ prompt: "chrome wasp" });
    assert.ok(out.url.startsWith("data:image/webp;base64,UklGR"));
  });

  it("sniffs jpeg, png, and gif prefixes", async () => {
    const cases = [
      ["/9j/4AAQ", "data:image/jpeg;base64,/9j/4AAQ"],
      ["iVBORw0KGgoAAA", "data:image/png;base64,iVBORw0KGgoAAA"],
      ["R0lGODlhAQAB", "data:image/gif;base64,R0lGODlhAQAB"],
    ];
    for (const [b64, want] of cases) {
      const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: b64 }] }) });
      const meta = createMetaProvider({ META_IMAGE_KEY: "i" }, fetchFn);
      const out = await meta.generatePortrait({ prompt: "x" });
      assert.equal(out.url, want);
    }
  });

  it("fails loudly on empty or unreadable image replies", async () => {
    for (const body of [{ data: [] }, { data: [{}] }, { data: [{ b64_json: "zzzzz" }] }]) {
      const fetchFn = async () => ({ ok: true, status: 200, json: async () => body });
      const meta = createMetaProvider({ META_IMAGE_KEY: "i" }, fetchFn);
      await assert.rejects(() => meta.generatePortrait({ prompt: "x" }), /no usable image/);
    }
  });
});

describe("prompt-to-chip targeting contract", () => {
  it("teaches Muse the same target controls the engine can execute", async () => {
    let system;
    const fetchFn = async (_url, init) => {
      system = JSON.parse(init.body).messages[0].content;
      return chatOk(POLICY_TEXT)();
    };
    await createMetaProvider({ META_SPARK_KEY: "key" }, fetchFn).compileStrategy({ prompt: "focus enemy heroes", agentVersionId: "v1" });
    for (const token of ["target", "FOE", "MINION", "STRUCTURE", "NONE", "first matching rule", "foeAlive"]) {
      assert.ok(system.includes(token), `missing ${token}`);
    }
    assert.ok(!system.includes("Robots auto-attack anything in range"));
  });
});

describe("malformed Muse responses", () => {
  it("returns validation errors rather than throwing for a missing rule list", async () => {
    const reply = JSON.stringify({ dna: { aggression: 50, evasion: 50, preferredDistance: 50, energyConservation: 50 } });
    const result = await createMetaProvider({ META_SPARK_KEY: "key" }, chatOk(reply)).compileStrategy({ prompt: "be careful", agentVersionId: "v1" });
    assert.equal(result.policy, null);
    assert.ok(result.errors.some((error) => error.includes("rules")));
  });
});

describe("compiled strategy in the MOBA engine", () => {
  it("keeps Muse's ordered target choices through validation and execution", async () => {
    const { createBattle, drive, DEFAULT_MOBA } = await import("../../battle-core/src/index.ts");
    const draft = { schemaVersion: 2, agentVersionId: "v1", dna: { aggression: 50, evasion: 50, preferredDistance: 50, energyConservation: 50 }, rules: [
      { id: "low-health-hold", when: { operand: "ownHpPct", op: "lt", value: 30 }, move: "RETREAT", target: "NONE" },
      { id: "focus-hero", when: { operand: "foeAlive", op: "eq", value: true }, move: "APPROACH", target: "FOE" },
    ] };
    const result = await createMetaProvider({ META_SPARK_KEY: "key" }, chatOk(JSON.stringify(draft))).compileStrategy({ prompt: "retreat without shooting when weak, otherwise target the enemy robot", agentVersionId: "v1" });
    assert.ok(result.policy, result.errors.join(", "));
    const s = createBattle(DEFAULT_MOBA);
    s.agents.A.pos = { x: 24, y: 8 };
    s.agents.B.pos = { x: 24, y: 10 };
    const attack = drive(s, result.policy, "A", DEFAULT_MOBA);
    assert.equal(attack.fire, true);
    assert.deepEqual(attack.aim, { x: 0, y: 1 });
    s.agents.A.hp = 100;
    const retreat = drive(s, result.policy, "A", DEFAULT_MOBA);
    assert.equal(retreat.fire, false);
    assert.ok(retreat.move.x < 0);
  });
});

describe("tactical compiler contract", () => {
  it("teaches Muse the real tower and wave sensors and actions", async () => {
    let brief = '';
    const fetchFn = async (_url, init) => { brief = JSON.parse(init.body).messages[0].content; return chatOk(POLICY_TEXT)(); };
    await createMetaProvider({ META_SPARK_KEY: 'test' }, fetchFn).compileStrategy({ prompt: 'wait until minions tank the tower', agentVersionId: 'v1' });
    for (const key of ['foeTowerTargetsAllyMinion', 'foeTowerTargetsMe', 'inFoeTowerRange', 'nearAllyMinionHp', 'nearFoeMinionHp', 'killableFoeMinionsInRange', 'nextWaveSeconds', 'distOwnBase', 'ownStructureThreatened', 'WAIT', 'LAST_HIT']) assert.ok(brief.includes(key), key);
  });
});
