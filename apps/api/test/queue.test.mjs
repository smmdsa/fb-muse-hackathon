import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/index.ts";
import {
  autobattleDigest,
  cancelTicket,
  compileAndPublish,
  createAgent,
  findHumanOpponent,
  installVersion,
  optInAutobattle,
  pauseAutobattle,
  readTicket,
  requestMatch,
  spendEnergy,
  BOT_SETTLE_MS,
} from "../src/flow.ts";

let store;

async function leader(handle, prompt, db = store) {
  const s = { id: `l-${handle}`, token: `t-${handle}` };
  db.db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run(s.id, handle, s.token);
  const a = await createAgent(db, {}, { leaderId: s.id, name: handle, concept: prompt });
  const v = await compileAndPublish(db, {}, { agentId: a.agentId, prompt });
  return { ...s, agentId: a.agentId, version: v.versionId };
}

before(() => {
  store = openStore(":memory:");
});

describe("matchmaking queue", () => {
  it("saves a compile as a draft with no implicit install", async () => {
    // Own arena: installed drafts here must not leak into the shared ladder.
    const arena = openStore(":memory:");
    const t0 = 900_000;
    const d = await leader("drafty", "rush them down up close", arena);
    const row = arena.db.prepare("SELECT active_version_id FROM agents WHERE id = ?").get(d.agentId);
    assert.equal(row.active_version_id, null);
    assert.throws(() => requestMatch(arena, { leaderId: d.id, versionId: d.version, mode: "casual" }, t0), /queue your active version/);
    assert.throws(() => installVersion(arena, { leaderId: d.id, agentId: d.agentId, versionId: "v-nope" }), /unknown version/);
    arena.close();
  });

  it("refuses a second open ticket in the same mode", async () => {
    const arena = openStore(":memory:");
    const t0 = 970_000;
    const d = await leader("single", "rush them down up close", arena);
    installVersion(arena, { leaderId: d.id, agentId: d.agentId, versionId: d.version });
    const first = requestMatch(arena, { leaderId: d.id, versionId: d.version, mode: "casual" }, t0);
    assert.equal(first.status, "queued");
    assert.throws(() => requestMatch(arena, { leaderId: d.id, versionId: d.version, mode: "casual" }, t0 + 1), /ticket already open/);
    const other = requestMatch(arena, { leaderId: d.id, versionId: d.version, mode: "ranked" }, t0 + 1);
    assert.equal(other.status, "queued");
    arena.close();
  });

  it("only pairs against opted-in foes under the defense cap", async () => {
    const arena = openStore(":memory:");
    const t0 = 990_000;
    const a = await leader("seeker", "rush them down up close", arena);
    const b = await leader("shy", "evade and stay safe far away", arena);
    installVersion(arena, { leaderId: a.id, agentId: a.agentId, versionId: a.version });
    installVersion(arena, { leaderId: b.id, agentId: b.agentId, versionId: b.version });
    const q = requestMatch(arena, { leaderId: a.id, versionId: a.version, mode: "ranked" }, t0);
    assert.equal(q.status, "queued");
    const lonely = readTicket(arena, { ticketId: q.id, leaderId: a.id }, t0 + 1);
    assert.equal(lonely.status, "queued");
    optInAutobattle(arena, b.id, t0);
    const paired = readTicket(arena, { ticketId: q.id, leaderId: a.id }, t0 + 2);
    assert.equal(paired.status, "settled");
    const capped = JSON.parse(arena.db.prepare("SELECT autobattle_json FROM leaders WHERE id = ?").get(b.id).autobattle_json);
    capped.defenseAt = [t0, t0 + 1, t0 + 2];
    arena.db.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").run(JSON.stringify(capped), b.id);
    const q2 = requestMatch(arena, { leaderId: a.id, versionId: a.version, mode: "ranked" }, t0 + 3);
    const skipped = readTicket(arena, { ticketId: q2.id, leaderId: a.id }, t0 + 4);
    assert.equal(skipped.status, "queued");
    const digest = autobattleDigest(arena, b.id, t0 + 5);
    assert.equal(digest.defense.used, 3);
    assert.equal(digest.defense.max, 3);
    arena.close();
  });

  it("installs a draft before the queue accepts it", async () => {
    // Own arena: installed drafts here must not leak into the shared ladder.
    const arena = openStore(":memory:");
    const t0 = 950_000;
    const d = await leader("installer", "evade and stay safe far away", arena);
    const out = installVersion(arena, { leaderId: d.id, agentId: d.agentId, versionId: d.version });
    assert.equal(out.activeVersionId, d.version);
    const q = requestMatch(arena, { leaderId: d.id, versionId: d.version, mode: "casual" }, t0);
    assert.equal(q.status, "queued");
    const alien = await leader("alien", "rush them down up close", arena);
    assert.throws(() => installVersion(arena, { leaderId: alien.id, agentId: d.agentId, versionId: d.version }), /not found for this leader/);
    arena.close();
  });

  it("queues casual with no humans and settles a same-band bot after 30s", async () => {
    const t0 = 1_000_000;
    const solo = await leader("solo", "rush them down up close");
    installVersion(store, { leaderId: solo.id, agentId: solo.agentId, versionId: solo.version });
    const q = requestMatch(store, { leaderId: solo.id, versionId: solo.version, mode: "casual" }, t0);
    assert.equal(q.status, "queued");
    assert.equal(q.settle_at, t0 + BOT_SETTLE_MS);
    const me = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(solo.id);
    assert.equal(JSON.parse(me.autobattle_json).attackAt.length, 1);
    const early = readTicket(store, { ticketId: q.id, leaderId: solo.id }, t0 + 10_000);
    assert.equal(early.status, "queued");
    assert.equal(early.match, undefined);
    const late = readTicket(store, { ticketId: q.id, leaderId: solo.id }, t0 + 31_000);
    assert.equal(late.status, "settled");
    assert.ok(late.match);
    assert.equal(late.match.rated, 0);
    assert.match(late.match.b_version, /^bot:/);
    assert.equal(late.foe_version, late.match.b_version);
  });

  it("pairs nearest ELO humans at once in ranked", async () => {
    const t0 = 2_000_000;
    const a = await leader("qa", "evade and stay safe far away");
    const b = await leader("qb", "rush them down up close");
    installVersion(store, { leaderId: a.id, agentId: a.agentId, versionId: a.version });
    installVersion(store, { leaderId: b.id, agentId: b.agentId, versionId: b.version });
    optInAutobattle(store, a.id, t0);
    optInAutobattle(store, b.id, t0);
    store.db.prepare("UPDATE leaders SET ap = ? WHERE id = ?").run(100, "l-solo");
    store.db.prepare("UPDATE leaders SET ap = ? WHERE id = ?").run(520, b.id);
    const q = requestMatch(store, { leaderId: a.id, versionId: a.version, mode: "ranked" }, t0);
    assert.equal(q.status, "settled");
    assert.equal(q.foe_version, b.version);
    const m = store.db.prepare("SELECT * FROM matches WHERE id = ?").get(q.match_id);
    assert.equal(m.rated, 1);
    // Settle ran: placement climbs even when a MOBA bout draws.
    const after = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(a.id);
    assert.equal(after.placement, 1);
  });

  it("expires a ranked ticket with no humans after ten minutes", async () => {
    const alone = openStore(":memory:");
    const t0 = 3_000_000;
    alone.db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run("l-alone", "alone", "t-alone");
    const a = await createAgent(alone, {}, { leaderId: "l-alone", name: "Alone", concept: "waits" });
    const v = await compileAndPublish(alone, {}, { agentId: a.agentId, prompt: "rush them down up close" });
    installVersion(alone, { leaderId: "l-alone", agentId: a.agentId, versionId: v.versionId });
    assert.equal(findHumanOpponent(alone, "l-alone", t0), null);
    const q = requestMatch(alone, { leaderId: "l-alone", versionId: v.versionId, mode: "ranked" }, t0);
    assert.equal(q.status, "queued");
    const early = readTicket(alone, { ticketId: q.id, leaderId: "l-alone" }, t0 + 60_000);
    assert.equal(early.status, "queued");
    const late = readTicket(alone, { ticketId: q.id, leaderId: "l-alone" }, t0 + 10 * 60_000 + 1);
    assert.equal(late.status, "expired");
    const kept = alone.db.prepare("SELECT * FROM leaders WHERE id = ?").get("l-alone");
    assert.equal(JSON.parse(kept.autobattle_json).attackAt.length, 0);
  });

  it("cancels a queued ticket and frees the daily slot", () => {
    const arena = openStore(":memory:");
    const t0 = 980_000;
    arena.db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run("l-quit", "quitter", "t-quit");
    const a = { id: "a-quit" };
    arena.db.prepare("INSERT INTO agents (id, leader_id, active_version_id) VALUES (?, ?, ?)").run(a.id, "l-quit", "v-quit");
    arena.db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "v-quit", a.id, JSON.stringify({ schemaVersion: 1, agentVersionId: "v-quit", dna: { aggression: 50, evasion: 50, preferredDistance: 50, energyConservation: 50 }, rules: [] }), "shim", t0,
    );
    const q = requestMatch(arena, { leaderId: "l-quit", versionId: "v-quit", mode: "ranked" }, t0);
    assert.equal(q.status, "queued");
    const spent = arena.db.prepare("SELECT autobattle_json FROM leaders WHERE id = ?").get("l-quit");
    assert.equal(JSON.parse(spent.autobattle_json).attackAt.length, 1);
    const out = cancelTicket(arena, { ticketId: q.id, leaderId: "l-quit" }, t0 + 1);
    assert.equal(out.status, "canceled");
    const back = arena.db.prepare("SELECT autobattle_json FROM leaders WHERE id = ?").get("l-quit");
    assert.equal(JSON.parse(back.autobattle_json).attackAt.length, 0);
    assert.throws(() => cancelTicket(arena, { ticketId: q.id, leaderId: "l-quit" }, t0 + 2), /nothing to cancel/);
    arena.close();
  });

  it("denies the queue past the daily cap", async () => {
    const t0 = 4_000_000;
    const c = await leader("spent", "hold the center patiently");
    installVersion(store, { leaderId: c.id, agentId: c.agentId, versionId: c.version });
    for (let i = 0; i < 10; i += 1) spendEnergy(store, c.id, t0 + i);
    assert.throws(() => requestMatch(store, { leaderId: c.id, versionId: c.version, mode: "casual" }, t0), /daily match cap reached/);
  });

  it("holds one queued row per mode at the database level", async () => {
    const arena = openStore(":memory:");
    const t0 = 5_000_000;
    const idx = arena.db.prepare("SELECT name FROM sqlite_master WHERE name = 'tickets_open_single'").get();
    assert.equal(idx.name, "tickets_open_single");
    const d = await leader("raced", "rush them down up close", arena);
    installVersion(arena, { leaderId: d.id, agentId: d.agentId, versionId: d.version });
    const first = requestMatch(arena, { leaderId: d.id, versionId: d.version, mode: "casual" }, t0);
    assert.equal(first.status, "queued");
    assert.throws(() => arena.db.prepare(
      "INSERT INTO tickets (id, leader_id, version_id, mode, status, created_at, settle_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)",
    ).run("t-race-loser", d.id, d.version, "casual", t0 + 1, t0 + 31001), /UNIQUE constraint failed: tickets\.leader_id/);
    const rows = arena.db.prepare("SELECT id FROM tickets WHERE leader_id = ? AND mode = ? AND status = 'queued'").all(d.id, "casual");
    assert.deepEqual(rows.map((r) => r.id), [first.id]);
    arena.close();
  });

  it("stop cancels open tickets and clears the queue line", async () => {
    const arena = openStore(":memory:");
    const t0 = 6_000_000;
    const d = await leader("stopper", "rush them down up close", arena);
    installVersion(arena, { leaderId: d.id, agentId: d.agentId, versionId: d.version });
    optInAutobattle(arena, d.id, t0, "ranked");
    const q = requestMatch(arena, { leaderId: d.id, versionId: d.version, mode: "ranked" }, t0 + 1);
    assert.equal(q.status, "queued");
    assert.equal(autobattleDigest(arena, d.id, t0 + 2).queue.mode, "ranked");
    const out = pauseAutobattle(arena, d.id, t0 + 3);
    assert.equal(out.state, "PAUSED_MANUAL");
    const row = arena.db.prepare("SELECT status FROM tickets WHERE id = ?").get(q.id);
    assert.equal(row.status, "canceled");
    const digest = autobattleDigest(arena, d.id, t0 + 4);
    assert.equal(digest.queue, null);
    assert.equal(digest.stopReason, "paused");
    const back = arena.db.prepare("SELECT autobattle_json FROM leaders WHERE id = ?").get(d.id);
    assert.equal(JSON.parse(back.autobattle_json).attackAt.length, 0);
    arena.close();
  });
});
