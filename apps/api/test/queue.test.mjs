import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/index.ts";
import {
  compileAndPublish,
  createAgent,
  findHumanOpponent,
  installVersion,
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
    assert.equal(JSON.parse(me.autobattle_json).stamina, 9);
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
    store.db.prepare("UPDATE leaders SET ap = ? WHERE id = ?").run(100, "l-solo");
    store.db.prepare("UPDATE leaders SET ap = ? WHERE id = ?").run(520, b.id);
    const q = requestMatch(store, { leaderId: a.id, versionId: a.version, mode: "ranked" }, t0);
    assert.equal(q.status, "settled");
    assert.equal(q.foe_version, b.version);
    const m = store.db.prepare("SELECT * FROM matches WHERE id = ?").get(q.match_id);
    assert.equal(m.rated, 1);
    const after = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(a.id);
    assert.notEqual(after.ap, 500);
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
    assert.equal(JSON.parse(kept.autobattle_json).stamina, 9);
  });

  it("denies the queue at zero energy", async () => {
    const t0 = 4_000_000;
    const c = await leader("spent", "hold the center patiently");
    installVersion(store, { leaderId: c.id, agentId: c.agentId, versionId: c.version });
    for (let i = 0; i < 10; i += 1) spendEnergy(store, c.id, t0 + i);
    assert.throws(() => requestMatch(store, { leaderId: c.id, versionId: c.version, mode: "casual" }, t0), /energy empty/);
  });
});
