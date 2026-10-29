import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/index.ts";
import {
  compileAndPublish,
  createAgent,
  installVersion,
  openTicket,
  readTicket,
  requestMatch,
} from "../src/flow.ts";

async function leader(handle, prompt, db) {
  const s = { id: `l-${handle}`, token: `t-${handle}` };
  db.db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run(s.id, handle, s.token);
  const a = await createAgent(db, {}, { leaderId: s.id, name: handle, concept: prompt });
  const v = await compileAndPublish(db, {}, { agentId: a.agentId, prompt });
  installVersion(db, { leaderId: s.id, agentId: a.agentId, versionId: v.versionId });
  return { ...s, agentId: a.agentId, version: v.versionId };
}

function paidFor(db, leaderId, matchKey, side) {
  const r = db.db.prepare("SELECT SUM(delta) AS total FROM wallet_txns WHERE idem_key = ?").get(`${matchKey}-${side}`);
  return r.total ?? 0;
}

describe("live matchmaking pairs", () => {
  it("pairs two queued humans at once in ranked", async () => {
    const arena = openStore(":memory:");
    const t0 = 5_000_000;
    const a = await leader("liva", "rush them down up close", arena);
    const b = await leader("livb", "hold the center patiently", arena);
    const qa = requestMatch(arena, { leaderId: a.id, versionId: a.version, mode: "ranked" }, t0);
    assert.equal(qa.status, "queued");
    const qb = requestMatch(arena, { leaderId: b.id, versionId: b.version, mode: "ranked" }, t0 + 1);
    assert.equal(qb.status, "settled");
    assert.equal(qb.match_id, qa.id);
    const back = readTicket(arena, { ticketId: qa.id, leaderId: a.id }, t0 + 2);
    assert.equal(back.status, "settled");
    assert.ok(back.match);
    assert.equal(back.match.id, qa.id);
    assert.equal(back.match.rated, 1);
    assert.equal(back.match.mode, "moba");
    assert.equal(back.foe_version, b.version);
    assert.equal(qb.foe_version, a.version);
    const m = arena.db.prepare("SELECT * FROM matches WHERE id = ?").get(qa.id);
    if (m.winner === "A") {
      assert.equal(m.paid_a, 25);
      assert.equal(m.paid_b, 10);
    } else if (m.winner === "B") {
      assert.equal(m.paid_a, 10);
      assert.equal(m.paid_b, 25);
    } else {
      assert.equal(m.paid_a, 0);
      assert.equal(m.paid_b, 0);
    }
    assert.equal(arena.db.prepare("SELECT placement FROM leaders WHERE id = ?").get(a.id).placement, 1);
    assert.equal(arena.db.prepare("SELECT placement FROM leaders WHERE id = ?").get(b.id).placement, 1);
    arena.close();
  });

  it("pairs two queued humans in casual with no bot and both sides paid", async () => {
    const arena = openStore(":memory:");
    const t0 = 6_000_000;
    const a = await leader("liva", "rush them down up close", arena);
    const b = await leader("livb", "hold the center patiently", arena);
    const qa = requestMatch(arena, { leaderId: a.id, versionId: a.version, mode: "casual" }, t0);
    assert.equal(qa.status, "queued");
    const qb = requestMatch(arena, { leaderId: b.id, versionId: b.version, mode: "casual" }, t0 + 1);
    assert.equal(qb.status, "settled");
    assert.equal(qb.match_id, qa.id);
    const m = arena.db.prepare("SELECT * FROM matches WHERE id = ?").get(qa.id);
    assert.equal(m.rated, 0);
    assert.equal(m.b_version, b.version);
    assert.equal(paidFor(arena, b.id, qa.id, "b"), m.paid_b);
    if (m.winner === "A") {
      assert.equal(m.paid_a, 25);
      assert.equal(m.paid_b, 10);
    } else if (m.winner === "B") {
      assert.equal(m.paid_a, 10);
      assert.equal(m.paid_b, 25);
    } else {
      assert.equal(m.paid_a, 0);
      assert.equal(m.paid_b, 0);
    }
    arena.close();
  });

  it("a poll pairs a live foe before the deadline in both modes", async () => {
    for (const mode of ["ranked", "casual"]) {
      const arena = openStore(":memory:");
      const t0 = 7_000_000;
      const a = await leader(`polla-${mode}`, "rush them down up close", arena);
      const b = await leader(`pollb-${mode}`, "hold the center patiently", arena);
      const qa = requestMatch(arena, { leaderId: a.id, versionId: a.version, mode }, t0);
      assert.equal(qa.status, "queued");
      arena.db.prepare(
        "INSERT INTO tickets (id, leader_id, version_id, mode, status, created_at, settle_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)",
      ).run(`t-live-${mode}`, b.id, b.version, mode, t0 + 1, t0 + 600_000);
      const paired = readTicket(arena, { ticketId: qa.id, leaderId: a.id }, t0 + 2);
      assert.equal(paired.status, "settled");
      assert.ok(paired.match);
      const foe = readTicket(arena, { ticketId: `t-live-${mode}`, leaderId: b.id }, t0 + 3);
      assert.equal(foe.status, "settled");
      assert.equal(foe.match_id, paired.match_id);
      arena.close();
    }
  });

  it("an expired-but-unread ticket never pairs", async () => {
    const arena = openStore(":memory:");
    const t0 = 8_000_000;
    const a = await leader("stale", "rush them down up close", arena);
    const b = await leader("fresh", "hold the center patiently", arena);
    const qa = requestMatch(arena, { leaderId: a.id, versionId: a.version, mode: "ranked" }, t0);
    assert.equal(qa.status, "queued");
    const qb = requestMatch(arena, { leaderId: b.id, versionId: b.version, mode: "ranked" }, t0 + 11 * 60_000);
    assert.equal(qb.status, "queued");
    const late = readTicket(arena, { ticketId: qa.id, leaderId: a.id }, t0 + 11 * 60_000 + 1);
    assert.equal(late.status, "expired");
    arena.close();
  });

  it("openTicket resumes the open ticket and clears after settle", async () => {
    const arena = openStore(":memory:");
    const t0 = 9_000_000;
    const a = await leader("resum", "rush them down up close", arena);
    const b = await leader("resuf", "hold the center patiently", arena);
    assert.equal(openTicket(arena, { leaderId: a.id, mode: "ranked" }), null);
    const qa = requestMatch(arena, { leaderId: a.id, versionId: a.version, mode: "ranked" }, t0);
    assert.equal(openTicket(arena, { leaderId: a.id, mode: "ranked" }).id, qa.id);
    assert.equal(openTicket(arena, { leaderId: a.id, mode: "casual" }), null);
    requestMatch(arena, { leaderId: b.id, versionId: b.version, mode: "ranked" }, t0 + 1);
    assert.equal(openTicket(arena, { leaderId: a.id, mode: "ranked" }), null);
    arena.close();
  });
});
