import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/index.ts";
import {
  compileAndPublish,
  createAgent,
  getTournament,
  installVersion,
  listTournaments,
  registerTournament,
} from "../src/flow.ts";

const PROMPTS = ["rush them down up close", "evade and stay far away", "hold the center patiently"];
let promptNo = 0;

async function leader(db, handle) {
  db.db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run(`l-${handle}`, handle, `t-${handle}`);
  const a = await createAgent(db, {}, { leaderId: `l-${handle}`, name: handle, concept: "cup" });
  const v = await compileAndPublish(db, {}, { agentId: a.agentId, prompt: PROMPTS[promptNo++ % PROMPTS.length] });
  installVersion(db, { leaderId: `l-${handle}`, agentId: a.agentId, versionId: v.versionId });
  return { id: `l-${handle}`, agentId: a.agentId, version: v.versionId };
}

describe("championship enrollment", () => {
  it("registers one hero per leader into the open cup", () => {
    const db = openStore(":memory:");
    return (async () => {
      const d = await leader(db, "cup1");
      const list = listTournaments(db);
      assert.equal(list.length, 1);
      assert.equal(list[0].id, "s1-kickoff");
      const reg = registerTournament(db, { eventId: "s1-kickoff", leaderId: d.id, versionId: d.version, now: 1_000 });
      assert.equal(reg.entered, true);
      assert.equal(reg.started, false);
      assert.throws(() => registerTournament(db, { eventId: "s1-kickoff", leaderId: d.id, versionId: d.version, now: 2_000 }), /already registered/);
      const ev = getTournament(db, "s1-kickoff");
      assert.equal(ev.entries.length, 1);
      db.close();
    })();
  });

  it("freezes versions at lock and plays the bracket to a champion", () => {
    const db = openStore(":memory:");
    return (async () => {
      const first = await leader(db, "froze");
      const old = first.version;
      registerTournament(db, { eventId: "s1-kickoff", leaderId: first.id, versionId: old, now: 1_000 });
      const a = db.db.prepare("SELECT * FROM agents WHERE leader_id = ?").get(first.id);
      const v2 = await compileAndPublish(db, {}, { agentId: a.id, prompt: "evade and stay far away" });
      installVersion(db, { leaderId: first.id, agentId: a.id, versionId: v2.versionId });
      for (const h of ["c2", "c3", "c4", "c5", "c6", "c7", "c8"]) {
        const d = await leader(db, h);
        registerTournament(db, { eventId: "s1-kickoff", leaderId: d.id, versionId: d.version, now: 2_000 });
      }
      const ev = getTournament(db, "s1-kickoff");
      assert.equal(ev.phase, "COMPLETED");
      assert.ok(ev.bracket.championId);
      assert.equal(ev.entries.find((e) => e.leaderId === first.id).lockedVersionId, old);
      const bouts = db.db.prepare("SELECT * FROM matches WHERE seed LIKE 'tmt-s1-kickoff-%'").all();
      // Draws replay: six blanks hand slot A, and the best-of final can add one.
      assert.ok(bouts.length >= 7 && bouts.length <= 43);
      for (const b of bouts) {
        assert.equal(b.rated, 0);
        // Cup rows stamp the A-side payout from the duel table: win 25,
        // loss 10, draw 0. The B side credits the wallet only.
        const wantA = b.winner === "A" ? 25 : b.winner === "B" ? 10 : 0;
        assert.equal(b.paid_a, wantA);
        assert.equal(b.paid_b, 0);
      }
      const champ = db.db.prepare("SELECT * FROM matches WHERE id = ?").get(bouts[0].id);
      assert.ok(champ.checksum);
      db.close();
    })();
  });
});
