import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import entry from "../src/worker.ts";
import { createBattle, DEFAULT_BATTLE, drive, stepBattle, checksum } from "@agent-wars/battle-core";

// A D1-shaped shim over node:sqlite. Same SQL, same call shape.
function shim(db) {
  return {
    prepare: (query) => ({
      bind: (...values) => ({
        first: async () => db.prepare(query).get(...values) ?? null,
        all: async () => ({ results: db.prepare(query).all(...values) }),
        run: async () => db.prepare(query).run(...values),
      }),
    }),
    batch: async (stmts) => {
      // No concurrent writers in one event: run the batch in order.
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}

let env;

const assetsStub = {
  fetch: async () => new Response("<!doctype html><title>Agent Wars</title>", {
    headers: { "content-type": "text/html" },
  }),
};

before(() => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../../../migrations/0001_schema.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../../../migrations/0002_platform.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../../../migrations/0003_matchmaking.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../../../migrations/0004_cost_audit.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../../../migrations/0005_portrait_status.sql", import.meta.url), "utf8"));
  db.prepare("INSERT INTO leaders (id, handle, token, rating_milli, ap, placement, placed) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "l1", "commander", "t1", 1020000, 520, 5, 1,
  );
  env = { DB: shim(db), ASSETS: assetsStub };
});

describe("worker reads", () => {
  it("answers health", async () => {
    const res = await entry.fetch(new Request("http://local/v1/health"), env);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });

  it("lists the board from D1 rows", async () => {
    const res = await entry.fetch(new Request("http://local/v1/leaderboard"), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.rows.map((r) => r.leaderId), ["l1"]);
  });

  it("denies unknown routes without a token", async () => {
    const res = await entry.fetch(new Request("http://local/v1/secret"), env);
    assert.equal(res.status, 401);
  });

  it("answers JSON 500 when the store breaks", async () => {
    const bad = {
      prepare: (query) => ({
        bind: () => ({
          first: async () => (String(query).includes("FROM leaders") ? { id: "l-broke", handle: "broke" } : null),
          all: async () => ({ results: [] }),
          run: async () => { throw new Error("disk gone"); },
        }),
      }),
    };
    const res = await entry.fetch(new Request("http://local/v1/agents", {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: "{}",
    }), { DB: bad, ASSETS: assetsStub });
    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /disk gone/);
  });

  it("serves the viewer shell at the root", async () => {
    const res = await entry.fetch(new Request("http://local/"), env);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.match(await res.text(), /Agent Wars/);
  });
});

describe("worker writes", () => {
  it("runs auth, agent, compile, training, and ranked end to end", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync(new URL("../../../migrations/0001_schema.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0002_platform.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0003_matchmaking.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0004_cost_audit.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0005_portrait_status.sql", import.meta.url), "utf8"));
    // Reuse the shared shim: it carries batch, like the real D1 binding.
    const wenv = { DB: shim(db), ASSETS: assetsStub };
    const call = (method, path, body, token) => {
      if (method !== "POST") throw new Error("writes only");
      return entry.fetch(
        new Request(`http://local${path}`, {
          method,
          headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        }),
        wenv,
      ).then(async (r) => ({ status: r.status, json: await r.json() }));
    };
    const sa = await call("POST", "/v1/auth/session", { handle: "wa" });
    assert.equal(sa.status, 200);
    const sb = await call("POST", "/v1/auth/session", { handle: "wb" });
    const aa = await call("POST", "/v1/agents", { name: "Wasp", concept: "fast striker" }, sa.json.token);
    assert.equal(aa.status, 201);
    assert.equal(aa.json.portraitUrl, null);
    assert.equal(aa.json.portraitStatus, "faceless");
    const dup = await call("POST", "/v1/agents", {}, sa.json.token);
    assert.equal(dup.status, 409);
    const ab = await call("POST", "/v1/agents", {}, sb.json.token);
    const va = await call("POST", `/v1/agents/${aa.json.agentId}/policies/compile`, { prompt: "rush them down up close" }, sa.json.token);
    assert.equal(va.status, 201);
    assert.equal(va.json.provider, "mock");
    assert.equal(va.json.isMock, true);
    assert.ok(va.json.tokens > 0);
    const vb = await call("POST", `/v1/agents/${ab.json.agentId}/policies/compile`, { prompt: "evade and stay far away" }, sb.json.token);
    assert.equal(vb.status, 201);
    const ia = await call("POST", `/v1/agents/${aa.json.agentId}/policies/install`, { versionId: va.json.versionId }, sa.json.token);
    assert.equal(ia.status, 200);
    assert.equal(ia.json.activeVersionId, va.json.versionId);
    const ib = await call("POST", `/v1/agents/${ab.json.agentId}/policies/install`, { versionId: vb.json.versionId }, sb.json.token);
    assert.equal(ib.status, 200);
    const alienInstall = await call("POST", `/v1/agents/${aa.json.agentId}/policies/install`, { versionId: va.json.versionId }, sb.json.token);
    assert.equal(alienInstall.status, 404);
    const retry = await call("POST", `/v1/agents/${aa.json.agentId}/portrait/retry`, {}, sa.json.token);
    assert.equal(retry.status, 200);
    assert.equal(retry.json.retried, true);
    assert.equal(retry.json.portraitStatus, "faceless");
    const alienRetry = await call("POST", `/v1/agents/${aa.json.agentId}/portrait/retry`, {}, sb.json.token);
    assert.equal(alienRetry.status, 404);
    const t = await call("POST", "/v1/matches/training", { versionId: va.json.versionId, seed: "wt-1" }, sa.json.token);
    assert.equal(t.status, 201);
    assert.ok(t.json.checksum);
    const r = await call("POST", "/v1/matches/ranked", { aVersionId: va.json.versionId, bVersionId: vb.json.versionId, seed: "wr-1", key: "wr-1" }, sa.json.token);
    assert.equal(r.status, 201);
    assert.equal(r.json.deltaB, -r.json.deltaA);
    const me = await entry.fetch(new Request("http://local/v1/me", {
      headers: { authorization: `Bearer ${sa.json.token}` },
    }), wenv);
    assert.equal((await me.json()).energy.energy, 9);
    const replay = await entry.fetch(new Request("http://local/v1/matches/wr-1/replay"), wenv);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).identical, true);
    const self = await call("POST", "/v1/matches/ranked", { aVersionId: va.json.versionId, bVersionId: va.json.versionId, seed: "ws-1", key: "ws-1" }, sa.json.token);
    assert.equal(self.status, 422);
    const meBefore = await (await entry.fetch(new Request("http://local/v1/me", {
      headers: { authorization: `Bearer ${sa.json.token}` },
    }), wenv)).json();
    const q = await call("POST", "/v1/matchmaking/request", { versionId: va.json.versionId, mode: "casual" }, sa.json.token);
    assert.equal(q.status, 201);
    assert.equal(q.json.status, "settled");
    assert.equal(q.json.foe_version, vb.json.versionId);
    assert.equal(q.json.match.rated, 0);
    const meAfter = await (await entry.fetch(new Request("http://local/v1/me", {
      headers: { authorization: `Bearer ${sa.json.token}` },
    }), wenv)).json();
    assert.equal(meAfter.leader.ap, meBefore.leader.ap);
    assert.equal(meAfter.energy.energy, meBefore.energy.energy - 1);
    const badMode = await call("POST", "/v1/matchmaking/request", { versionId: va.json.versionId, mode: "arena" }, sa.json.token);
    assert.equal(badMode.status, 400);
    const foreign = await entry.fetch(new Request(`http://local/v1/matchmaking/${q.json.id}`, {
      headers: { authorization: `Bearer ${sb.json.token}` },
    }), wenv);
    assert.equal(foreign.status, 404);
    const mine = await entry.fetch(new Request(`http://local/v1/matchmaking/${q.json.id}`, {
      headers: { authorization: `Bearer ${sa.json.token}` },
    }), wenv);
    assert.equal(mine.status, 200);
    assert.equal((await mine.json()).status, "settled");
    const crossCompile = await call("POST", `/v1/agents/${aa.json.agentId}/policies/compile`, { prompt: "rush" }, sb.json.token);
    assert.equal(crossCompile.status, 404);
    const crossTrain = await call("POST", "/v1/matches/training", { versionId: va.json.versionId, seed: "x-1" }, sb.json.token);
    assert.equal(crossTrain.status, 404);
    const board = await entry.fetch(new Request(`http://local/v1/agents/${aa.json.agentId}/dashboard`, {
      headers: { authorization: `Bearer ${sa.json.token}` },
    }), wenv);
    assert.equal(board.status, 200);
    const dash = await board.json();
    assert.equal(dash.agent.name, "Wasp");
    assert.equal(dash.leader.tier, "CIRCUIT");
    assert.equal(dash.versions.length, 1);
    assert.equal(dash.versions[0].fights, 3);
    assert.equal(dash.versions[0].chips.length > 0, true);
    const fired = dash.versions[0].chips.reduce((n, c) => n + c.triggers, 0);
    assert.ok(fired > 0 && fired <= dash.versions[0].avgTicks * dash.versions[0].fights);
  });
});

describe("worker replay", () => {
  const rush = {
    schemaVersion: 1,
    agentVersionId: "v1",
    dna: { aggression: 80, evasion: 30, preferredDistance: 20, energyConservation: 35 },
    rules: [
      { id: "close", when: { operand: "distFoe", op: "lt", value: 8 }, move: "APPROACH", fire: true },
      { id: "far", when: { operand: "distFoe", op: "gte", value: 8 }, move: "APPROACH" },
    ],
  };

  it("replays a finished match with identical checksum", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync(new URL("../../../migrations/0001_schema.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0002_platform.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0003_matchmaking.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0004_cost_audit.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0005_portrait_status.sql", import.meta.url), "utf8"));
    db.prepare("INSERT INTO leaders (id, handle, token, rating_milli, ap, placement, placed) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "l9", "replay-leader", "t9", 1020000, 520, 5, 1,
    );
    db.prepare("INSERT INTO agents (id, leader_id, active_version_id) VALUES (?, ?, ?)").run("a9", "l9", "v9");
    db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "v9", "a9", JSON.stringify(rush), "shim", Date.now(),
    );
    db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "v9b", "a9", JSON.stringify(rush), "shim", Date.now(),
    );
    const cfg = { ...DEFAULT_BATTLE, seed: "replay-seed-1" };
    let state = createBattle(cfg);
    let guard = 0;
    while (!state.over && guard < cfg.world.maxTicks) {
      state = stepBattle(state, { A: drive(state, rush, "A", cfg), B: drive(state, rush, "B", cfg) }, cfg);
      guard += 1;
    }
    db.prepare(
      "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
    ).run("m9", "replay-seed-1", "v9", "v9b", state.winner ?? "DRAW", state.tick, checksum(state), Date.now());
    const shimmed = {
      prepare: (query) => ({
        bind: (...values) => ({
          first: async () => db.prepare(query).get(...values) ?? null,
          all: async () => ({ results: db.prepare(query).all(...values) }),
          run: async () => db.prepare(query).run(...values),
        }),
      }),
    };
    const res = await entry.fetch(new Request("http://local/v1/matches/m9/replay"), { DB: shimmed, ASSETS: assetsStub });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.identical, true);
    assert.equal(body.recomputed.checksum, body.stored.checksum);
    assert.equal(body.recomputed.ticks, body.stored.ticks);
    assert.ok(body.replay.frames.length > 10);
    assert.equal(body.replay.checksum, body.stored.checksum);
    assert.equal(body.replay.frames[0].t, 0);
  });

  it("replays a bot fight from the preset", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync(new URL("../../../migrations/0001_schema.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0002_platform.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0003_matchmaking.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0004_cost_audit.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0005_portrait_status.sql", import.meta.url), "utf8"));
    db.prepare("INSERT INTO leaders (id, handle, token, rating_milli, ap, placement, placed) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "l8", "bot-leader", "t8", 1020000, 520, 5, 1,
    );
    db.prepare("INSERT INTO agents (id, leader_id, active_version_id) VALUES (?, ?, ?)").run("a8", "l8", "v8");
    db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "v8", "a8", JSON.stringify(rush), "shim", Date.now(),
    );
    db.prepare(
      "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, created_at, chips_json) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    ).run("m8", "bot-seed-1", "v8", "bot:bench", "A", 2700, "shim", Date.now(), "{}");
    const shimmed = {
      prepare: (query) => ({
        bind: (...values) => ({
          first: async () => db.prepare(query).get(...values) ?? null,
          all: async () => ({ results: db.prepare(query).all(...values) }),
          run: async () => db.prepare(query).run(...values),
        }),
      }),
    };
    const res = await entry.fetch(new Request("http://local/v1/matches/m8/replay"), { DB: shimmed, ASSETS: assetsStub });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.identical, false);
    assert.ok(body.replay.frames.length > 10);
  });
});
