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
    db.exec(readFileSync(new URL("../../../migrations/0006_match_payouts.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0007_tournaments.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0008_armory.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0009_season_archives.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../../../migrations/0012_match_mode.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0013_ai_cooldowns.sql", import.meta.url), "utf8"));
  db.prepare("INSERT INTO leaders (id, handle, token, rating_milli, ap, placement, placed) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "l1", "commander", "t1", 1020000, 520, 5, 1,
  );
  db.prepare("INSERT INTO agents (id, leader_id, active_version_id, name) VALUES (?, ?, ?, ?)").run(
    "a1", "l1", null, "NOVA-7",
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
    assert.equal(body.rows[0].handle, "commander");
    assert.equal(body.rows[0].agentName, "NOVA-7");
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
    db.exec(readFileSync(new URL("../../../migrations/0006_match_payouts.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0007_tournaments.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0008_armory.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0009_season_archives.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0010_reports.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0011_version_labels.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0012_match_mode.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0013_ai_cooldowns.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0014_wallet_auth.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0015_handle_set.sql", import.meta.url), "utf8"));
    // Reuse the shared shim: it carries batch, like the real D1 binding.
    const wenv = { DB: shim(db), ASSETS: assetsStub, ADMIN_KEY: "test-admin" };
    const call = (method, path, body, token, extraHeaders) => {
      if (method !== "POST") throw new Error("writes only");
      return entry.fetch(
        new Request(`http://local${path}`, {
          method,
          headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(extraHeaders || {}) },
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
    // MOBA bouts can draw: the sum form stays exact at zero too.
    assert.equal(r.json.deltaA + r.json.deltaB, 0);
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
    const sbOpt = await call("POST", "/v1/autobattle/opt-in", {}, sb.json.token);
    assert.equal(sbOpt.status, 200);
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
    const deadCancel = await call("POST", `/v1/matchmaking/${q.json.id}/cancel`, {}, sa.json.token);
    assert.equal(deadCancel.status, 404);
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
    // Every tick tallies exactly one rule per side, named or fallback.
    // The stored tallies must sum to the fought ticks, no more, no less.
    const stored = db.prepare("SELECT chips_json, a_version FROM matches WHERE a_version = ? OR b_version = ?").all(va.json.versionId, va.json.versionId);
    let tallied = 0;
    for (const m of stored) {
      const side = m.a_version === va.json.versionId ? "a" : "b";
      tallied += Object.values(JSON.parse(m.chips_json)[side] ?? {}).reduce((n, x) => n + x, 0);
    }
    const totalTicks = dash.history.reduce((n, h) => n + h.ticks, 0);
    assert.equal(tallied, totalTicks);
    assert.ok(Array.isArray(dash.history));
    const wr = dash.history.find((h) => h.matchId === "wr-1");
    assert.ok(wr);
    assert.equal(wr.rated, 1);
    assert.equal(typeof wr.myDelta, "number");
    assert.equal(typeof wr.replay, "string");
    const pub = await entry.fetch(new Request("http://local/v1/leaders/wa/public"), wenv);
    assert.equal(pub.status, 200);
    const card = await pub.json();
    assert.equal(card.handle, "wa");
    // Draws count for neither side, so the card sums decisive bouts only.
    const vaFights = db.prepare("SELECT winner FROM matches WHERE a_version = ? OR b_version = ?").all(va.json.versionId, va.json.versionId);
    const decisive = vaFights.filter((m) => m.winner === "A" || m.winner === "B").length;
    assert.equal(card.agent.wins + card.agent.losses, decisive);
    const raw = JSON.stringify(card);
    assert.ok(!raw.includes("token") && !raw.includes("lease") && !raw.includes("wallet"));
    const rep = await call("POST", "/v1/leaders/wa/report", { reason: "d1 spam" }, sb.json.token);
    assert.equal(rep.status, 200);
    assert.equal(rep.json.received, true);
    const ghost = await entry.fetch(new Request("http://local/v1/leaders/ghost/public"), wenv);
    assert.equal(ghost.status, 404);
    const bout = await call("POST", "/v1/matches/training", { versionId: va.json.versionId, seed: "wl-1" }, sa.json.token);
    assert.equal(bout.status, 201);
    const an = await call("POST", `/v1/battles/${bout.json.matchId}/analysis`, {}, sa.json.token);
    assert.equal(an.status, 200);
    assert.equal(an.json.checksum, bout.json.checksum);
    assert.ok(an.json.explanation.text.includes(bout.json.checksum));
    assert.equal(an.json.explanation.grounded, true);
    const ghostAn = await call("POST", "/v1/battles/ghost/analysis", {}, sa.json.token);
    assert.equal(ghostAn.status, 404);
    const ADMIN = { "x-admin-key": "test-admin" };
    const noKey = await call("POST", "/v1/admin/events", { id: "w-cup", name: "W", maxPlayers: 2, minAp: 0, registrationCloseAt: Date.now() + 1000 }, null, {});
    assert.equal(noKey.status, 401);
    const mk = await call("POST", "/v1/admin/events", { id: "w-cup", name: "W Cup", maxPlayers: 2, minAp: 0, registrationCloseAt: Date.now() + 86_400_000 }, null, ADMIN);
    assert.equal(mk.status, 201);
    assert.equal(mk.json.phase, "DRAFT");
    for (const to of ["ANNOUNCED", "REGISTRATION_OPEN"]) {
      const step = await call("POST", "/v1/admin/events/w-cup/transition", { to }, null, ADMIN);
      assert.equal(step.status, 200);
    }
    const ra = await entry.fetch(new Request("http://local/v1/tournaments/w-cup/register", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sa.json.token}` },
      body: JSON.stringify({ versionId: va.json.versionId }),
    }), wenv);
    assert.equal(ra.status, 201);
    const rb = await entry.fetch(new Request("http://local/v1/tournaments/w-cup/register", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sb.json.token}` },
      body: JSON.stringify({ versionId: vb.json.versionId }),
    }), wenv);
    assert.equal(rb.status, 201);
    assert.equal((await rb.json()).event.phase, "SEEDED");
    for (const to of ["LIVE", "COMPLETED"]) {
      const step = await call("POST", "/v1/admin/events/w-cup/transition", { to }, null, ADMIN);
      assert.equal(step.status, 200);
      assert.equal(step.json.phase, to);
    }
    const jump = await call("POST", "/v1/admin/events/s1-kickoff/transition", { to: "COMPLETED" }, null, ADMIN);
    assert.equal(jump.status, 422);
    const over = await call("POST", `/v1/agents/${aa.json.agentId}/policies/compile`, { prompt: "x".repeat(2001) }, sa.json.token);
    assert.equal(over.status, 400);
    db.prepare("UPDATE ai_cooldowns SET next_allowed_at = 0").run();
    const spare = await call("POST", `/v1/agents/${aa.json.agentId}/policies/compile`, { prompt: "hold the center patiently" }, sa.json.token);
    assert.equal(spare.status, 201);
    const gone = await entry.fetch(new Request(`http://local/v1/agents/${aa.json.agentId}/policies/${spare.json.versionId}`, { method: "DELETE", headers: { authorization: `Bearer ${sa.json.token}` } }), wenv);
    assert.equal(gone.status, 200);
    const keep = await entry.fetch(new Request(`http://local/v1/agents/${aa.json.agentId}/policies/${va.json.versionId}`, { method: "DELETE", headers: { authorization: `Bearer ${sa.json.token}` } }), wenv);
    assert.equal(keep.status, 422);
    await wenv.DB.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at, provider, is_mock, tokens, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("v-wpoison", aa.json.agentId, "broken{{{", "x", Date.now(), "meta", 0, 0, 0).run();
    const dashW = await entry.fetch(new Request(`http://local/v1/agents/${aa.json.agentId}/dashboard`, { headers: { authorization: `Bearer ${sa.json.token}` } }), wenv);
    assert.equal(dashW.status, 200);
    const flagged = (await dashW.json()).versions.find((v) => v.versionId === "v-wpoison");
    assert.equal(flagged.corrupt, true);
    assert.deepEqual(flagged.chips, []);
    const rn = await call("POST", `/v1/agents/${aa.json.agentId}/policies/${va.json.versionId}/rename`, { label: "Alpha prime" }, sa.json.token);
    assert.equal(rn.status, 200);
    assert.equal(rn.json.label, "Alpha prime");
    const dashW2 = await entry.fetch(new Request(`http://local/v1/agents/${aa.json.agentId}/dashboard`, { headers: { authorization: `Bearer ${sa.json.token}` } }), wenv);
    assert.equal((await dashW2.json()).versions.find((v) => v.versionId === va.json.versionId).label, "Alpha prime");
    const fdel = await call("POST", `/v1/agents/${aa.json.agentId}/policies/${va.json.versionId}/force-delete`, {}, sa.json.token);
    assert.equal(fdel.status, 200);
    assert.equal(fdel.json.clearedActive, true);
  });

  it("stays dark with no admin key", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync(new URL("../../../migrations/0001_schema.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0002_platform.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0003_matchmaking.sql", import.meta.url), "utf8"));
    const darkEnv = { DB: shim(db), ASSETS: assetsStub };
    const res = await entry.fetch(new Request("http://local/v1/admin/events", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-key": "anything" },
      body: JSON.stringify({ id: "x", name: "X", maxPlayers: 2, minAp: 0, registrationCloseAt: Date.now() + 1000 }),
    }), darkEnv);
    assert.equal(res.status, 503);
  });

  it("refuses a second open ticket in the same mode", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync(new URL("../../../migrations/0001_schema.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0002_platform.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0003_matchmaking.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0004_cost_audit.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0005_portrait_status.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0006_match_payouts.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0007_tournaments.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0008_armory.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0009_season_archives.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0012_match_mode.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0013_ai_cooldowns.sql", import.meta.url), "utf8"));
    db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run("l7", "solo7", "t7");
    db.prepare("INSERT INTO agents (id, leader_id, active_version_id) VALUES (?, ?, ?)").run("a7", "l7", "v7");
    db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "v7", "a7", JSON.stringify({ schemaVersion: 1, agentVersionId: "v7", dna: { aggression: 80, evasion: 40, preferredDistance: 25, energyConservation: 50 }, rules: [{ id: "r", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true }] }), "shim", Date.now(),
    );
    const wenv = { DB: shim(db), ASSETS: assetsStub };
    const post = (path, body) => entry.fetch(new Request(`http://local${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer t7" },
      body: JSON.stringify(body),
    }), wenv).then(async (r) => ({ status: r.status, json: await r.json() }));
    const first = await post("/v1/matchmaking/request", { versionId: "v7", mode: "ranked" });
    assert.equal(first.status, 201);
    assert.equal(first.json.status, "queued");
    const dup = await post("/v1/matchmaking/request", { versionId: "v7", mode: "ranked" });
    assert.equal(dup.status, 200);
    assert.equal(dup.json.id, first.json.id);
    assert.equal(dup.json.status, "queued");
    const other = await post("/v1/matchmaking/request", { versionId: "v7", mode: "casual" });
    assert.equal(other.status, 201);
    const cancel = await post(`/v1/matchmaking/${first.json.id}/cancel`, {});
    assert.equal(cancel.status, 200);
    assert.equal(cancel.json.status, "canceled");
    const me = await entry.fetch(new Request("http://local/v1/me", {
      headers: { authorization: "Bearer t7" },
    }), wenv);
    assert.equal((await me.json()).energy.energy, 9);
    const cancelOther = await post(`/v1/matchmaking/${other.json.id}/cancel`, {});
    assert.equal(cancelOther.status, 200);
    const full = await entry.fetch(new Request("http://local/v1/me", {
      headers: { authorization: "Bearer t7" },
    }), wenv);
    assert.equal((await full.json()).energy.energy, 10);
  });

  it("settles a ranked ticket the moment a human foe stands by", async () => {
    const db = new DatabaseSync(":memory:");
    for (const m of ["0001_schema", "0002_platform", "0003_matchmaking", "0004_cost_audit", "0005_portrait_status", "0006_match_payouts", "0007_tournaments", "0008_armory", "0009_season_archives", "0012_match_mode", "0013_ai_cooldowns"]) {
      db.exec(readFileSync(new URL(`../../../migrations/${m}.sql`, import.meta.url), "utf8"));
    }
    const policy = (id) => JSON.stringify({ schemaVersion: 1, agentVersionId: id, dna: { aggression: 80, evasion: 40, preferredDistance: 25, energyConservation: 50 }, rules: [{ id: "r", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true }] });
    db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run("l20", "queuer20", "t20");
    db.prepare("INSERT INTO agents (id, leader_id, active_version_id) VALUES (?, ?, ?)").run("a20", "l20", "v20");
    db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").run("v20", "a20", policy("v20"), "shim", Date.now());
    db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run("l21", "foe21", "t21");
    db.prepare("INSERT INTO agents (id, leader_id, active_version_id) VALUES (?, ?, ?)").run("a21", "l21", "v21");
    db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").run("v21", "a21", policy("v21"), "shim", Date.now());
    const wenv = { DB: shim(db), ASSETS: assetsStub };
    const as = (token) => (method, path, body) => entry.fetch(new Request(`http://local${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    }), wenv).then(async (r) => ({ status: r.status, json: await r.json() }));
    const opt = await as("t21")("POST", "/v1/autobattle/opt-in");
    assert.equal(opt.status, 200);
    const q = await as("t20")("POST", "/v1/matchmaking/request", { versionId: "v20", mode: "ranked" });
    assert.equal(q.status, 201);
    assert.equal(q.json.status, "settled");
    assert.ok(q.json.match_id);
    const row = db.prepare("SELECT * FROM matches WHERE id = ?").get(q.json.match_id);
    assert.equal(row.rated, 1);
    assert.equal(row.a_version, "v20");
    assert.equal(row.b_version, "v21");
  });

  it("opts in, runs background fights, and digests without renewing", async () => {
    const db = new DatabaseSync(":memory:");
    for (const m of ["0001_schema", "0002_platform", "0003_matchmaking", "0004_cost_audit", "0005_portrait_status", "0006_match_payouts", "0007_tournaments", "0008_armory", "0009_season_archives", "0012_match_mode", "0013_ai_cooldowns"]) {
      db.exec(readFileSync(new URL(`../../../migrations/${m}.sql`, import.meta.url), "utf8"));
    }
    db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run("l10", "auto10", "t10");
    db.prepare("INSERT INTO agents (id, leader_id, active_version_id) VALUES (?, ?, ?)").run("a10", "l10", "v10");
    db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "v10", "a10", JSON.stringify({ schemaVersion: 1, agentVersionId: "v10", dna: { aggression: 80, evasion: 40, preferredDistance: 25, energyConservation: 50 }, rules: [{ id: "r", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true }] }), "shim", Date.now(),
    );
    const wenv = { DB: shim(db), ASSETS: assetsStub };
    const call = (method, path, body) => entry.fetch(new Request(`http://local${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: "Bearer t10", ...(body ? {} : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), wenv).then(async (r) => ({ status: r.status, json: await r.json() }));
    const opt = await call("POST", "/v1/autobattle/opt-in");
    assert.equal(opt.status, 200);
    assert.equal(opt.json.ran, 3);
    assert.equal(opt.json.matches.length, 3);
    const me = await call("GET", "/v1/me");
    assert.equal(me.json.auto.optIn, true);
    assert.equal(me.json.auto.ran, 7);
    const pause = await call("POST", "/v1/autobattle/pause");
    assert.equal(pause.json.state, "PAUSED_MANUAL");
    const before = await call("GET", "/v1/autobattle/digest");
    const after = await call("GET", "/v1/autobattle/digest");
    assert.equal(before.json.leaseExpiresAt, after.json.leaseExpiresAt);
    assert.equal(after.json.stopReason, "paused");
    assert.equal(after.json.recent.length, 10);
  });

  it("lists the cup and registers one hero", async () => {
    const db = new DatabaseSync(":memory:");
    for (const m of ["0001_schema", "0002_platform", "0003_matchmaking", "0004_cost_audit", "0005_portrait_status", "0006_match_payouts", "0007_tournaments", "0008_armory", "0009_season_archives", "0012_match_mode", "0013_ai_cooldowns"]) {
      db.exec(readFileSync(new URL(`../../../migrations/${m}.sql`, import.meta.url), "utf8"));
    }
    db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run("l11", "cup11", "t11");
    db.prepare("INSERT INTO agents (id, leader_id, active_version_id) VALUES (?, ?, ?)").run("a11", "l11", "v11");
    db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "v11", "a11", JSON.stringify({ schemaVersion: 1, agentVersionId: "v11", dna: { aggression: 80, evasion: 40, preferredDistance: 25, energyConservation: 50 }, rules: [{ id: "r", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true }] }), "shim", Date.now(),
    );
    const wenv = { DB: shim(db), ASSETS: assetsStub };
    const call = (method, path, body) => entry.fetch(new Request(`http://local${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: "Bearer t11" },
      body: body ? JSON.stringify(body) : undefined,
    }), wenv).then(async (r) => ({ status: r.status, json: await r.json() }));
    const list = await call("GET", "/v1/tournaments");
    assert.equal(list.json.tournaments.length, 1);
    assert.equal(list.json.tournaments[0].entries, 0);
    const reg = await call("POST", "/v1/tournaments/s1-kickoff/register", { versionId: "v11" });
    assert.equal(reg.status, 201);
    assert.equal(reg.json.entered, true);
    assert.equal(reg.json.started, false);
    const dup = await call("POST", "/v1/tournaments/s1-kickoff/register", { versionId: "v11" });
    assert.equal(dup.status, 404);
    const one = await call("GET", "/v1/tournaments/s1-kickoff");
    assert.equal(one.json.entries.length, 1);
    assert.equal(one.json.phase, "REGISTRATION_OPEN");
  });

  it("sells and equips cosmetics without touching combat", async () => {
    const db = new DatabaseSync(":memory:");
    for (const m of ["0001_schema", "0002_platform", "0003_matchmaking", "0004_cost_audit", "0005_portrait_status", "0006_match_payouts", "0007_tournaments", "0008_armory", "0009_season_archives", "0012_match_mode", "0013_ai_cooldowns"]) {
      db.exec(readFileSync(new URL(`../../../migrations/${m}.sql`, import.meta.url), "utf8"));
    }
    db.prepare("INSERT INTO leaders (id, handle, token, ac) VALUES (?, ?, ?, ?)").run("l12", "shop12", "t12", 120);
    db.prepare("INSERT INTO agents (id, leader_id, active_version_id) VALUES (?, ?, ?)").run("a12", "l12", "v12");
    db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "v12", "a12", JSON.stringify({ schemaVersion: 1, agentVersionId: "v12", dna: { aggression: 80, evasion: 40, preferredDistance: 25, energyConservation: 50 }, rules: [{ id: "r", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true }] }), "shim", Date.now(),
    );
    const wenv = { DB: shim(db), ASSETS: assetsStub };
    const call = (method, path, body) => entry.fetch(new Request(`http://local${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: "Bearer t12" },
      body: body ? JSON.stringify(body) : undefined,
    }), wenv).then(async (r) => ({ status: r.status, json: await r.json() }));
    const list = await call("GET", "/v1/armory");
    assert.equal(list.status, 200);
    assert.ok(list.json.catalog.length >= 4);
    const buy = await call("POST", "/v1/armory/buy", { itemId: "skin-ember" });
    assert.equal(buy.status, 200);
    assert.equal(buy.json.ac, 20);
    const again = await call("POST", "/v1/armory/buy", { itemId: "skin-ember" });
    assert.equal(again.status, 200);
    assert.equal(again.json.ac, 20);
    const poor = await call("POST", "/v1/armory/buy", { itemId: "skin-tide" });
    assert.equal(poor.status, 422);
    const fit = await call("POST", "/v1/armory/equip", { slot: "skin", itemId: "skin-ember" });
    assert.equal(fit.status, 200);
    assert.equal(fit.json.equipped.skin, "skin-ember");
  });

  it("reads back frozen season archives", async () => {
    const db = new DatabaseSync(":memory:");
    for (const m of ["0001_schema", "0009_season_archives", "0012_match_mode", "0013_ai_cooldowns"]) {
      db.exec(readFileSync(new URL(`../../../migrations/${m}.sql`, import.meta.url), "utf8"));
    }
    db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run("l13", "hist13", "t13");
    db.prepare("INSERT INTO season_archives (season_id, closed_at, archive_json) VALUES (?, ?, ?)").run(
      "s0", 1000, JSON.stringify({ rows: [{ rank: 1, leaderId: "l-old", ap: 640 }] }),
    );
    const wenv = { DB: shim(db), ASSETS: assetsStub };
    const r = await entry.fetch(new Request("http://local/v1/seasons", {
      headers: { authorization: "Bearer t13" },
    }), wenv);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.seasons.length, 1);
    assert.equal(body.seasons[0].rows[0].ap, 640);
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
    db.exec(readFileSync(new URL("../../../migrations/0006_match_payouts.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0007_tournaments.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0008_armory.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0009_season_archives.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0012_match_mode.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0013_ai_cooldowns.sql", import.meta.url), "utf8"));
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
    db.exec(readFileSync(new URL("../../../migrations/0006_match_payouts.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0007_tournaments.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0008_armory.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0009_season_archives.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0012_match_mode.sql", import.meta.url), "utf8"));
    db.exec(readFileSync(new URL("../../../migrations/0013_ai_cooldowns.sql", import.meta.url), "utf8"));
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

describe("worker ftue", () => {
  it("pays each guided stage once", async () => {
    const db = new DatabaseSync(":memory:");
    for (const m of ["0001_schema", "0002_platform", "0003_matchmaking", "0004_cost_audit", "0005_portrait_status", "0006_match_payouts", "0007_tournaments", "0008_armory", "0009_season_archives", "0010_reports", "0011_version_labels", "0012_match_mode", "0013_ai_cooldowns", "0014_wallet_auth", "0015_handle_set"]) {
      db.exec(readFileSync(new URL(`../../../migrations/${m}.sql`, import.meta.url), "utf8"));
    }
    const wenv = { DB: shim(db), ASSETS: assetsStub };
    const wcall = (method, path, body, token) => entry.fetch(
      new Request(`http://local${path}`, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }),
      wenv,
    ).then(async (r) => ({ status: r.status, json: await r.json() }));
    const s = await wcall("POST", "/v1/auth/session", { handle: "wf" });
    const token = s.json.token;
    const fresh = await wcall("GET", "/v1/ftue", null, token);
    assert.equal(fresh.status, 200);
    assert.ok(fresh.json.stages.every((x) => x.done === false));
    const early = await wcall("POST", "/v1/ftue/claim", { stage: 1 }, token);
    assert.equal(early.status, 422);
    const bred = await wcall("POST", "/v1/agents", { name: "Wf-1", concept: "worker rookie" }, token);
    assert.equal(bred.status, 201);
    const one = await wcall("POST", "/v1/ftue/claim", { stage: 1 }, token);
    assert.equal(one.json.rewarded, true);
    assert.equal(one.json.ac, 200);
    const replay = await wcall("POST", "/v1/ftue/claim", { stage: 1 }, token);
    assert.equal(replay.json.rewarded, false);
    assert.equal(replay.json.ac, 200);
    const draft = await wcall("POST", `/v1/agents/${bred.json.agentId}/policies/compile`, { prompt: "hold the center patiently" }, token);
    await wcall("POST", `/v1/agents/${bred.json.agentId}/policies/install`, { versionId: draft.json.versionId }, token);
    const two = await wcall("POST", "/v1/ftue/claim", { stage: 2 }, token);
    assert.equal(two.json.rewarded, true);
    assert.equal(two.json.ac, 400);
    const dash = await wcall("GET", `/v1/agents/${bred.json.agentId}/dashboard`, null, token);
    assert.equal(dash.json.ftue.filter((x) => x.done).length, 2);
  });
});
