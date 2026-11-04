import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/index.ts";
import {
  autobattleDigest,
  autobattleTick,
  compileAndPublish,
  createAgent,
  installVersion,
  optInAutobattle,
  pauseAutobattle,
} from "../src/flow.ts";

const PROMPT = "rush them down up close";

async function leader(db, handle) {
  db.db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run(`l-${handle}`, handle, `t-${handle}`);
  const a = await createAgent(db, {}, { leaderId: `l-${handle}`, name: handle, concept: "auto" });
  const v = await compileAndPublish(db, {}, { agentId: a.agentId, prompt: PROMPT });
  installVersion(db, { leaderId: `l-${handle}`, agentId: a.agentId, versionId: v.versionId });
  return { id: `l-${handle}`, agentId: a.agentId, version: v.versionId };
}

describe("autobattle scheduler", () => {
  it("refuses opt-in with no installed version", () => {
    const db = openStore(":memory:");
    db.db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run("l-bare", "bare", "t-bare");
    assert.throws(() => optInAutobattle(db, "l-bare", 1_000), /published version/);
    db.close();
  });

  it("opts in for 24h and runs bot fights while alone", () => {
    const db = openStore(":memory:");
    const t0 = 1_000_000;
    return (async () => {
      const d = await leader(db, "solo-auto");
      const opt = optInAutobattle(db, d.id, t0);
      assert.equal(opt.leaseExpiresAt, t0 + 24 * 60 * 60 * 1000);
      const tick = autobattleTick(db, d.id, t0 + 1, 3);
      assert.equal(tick.ran, 3);
      assert.equal(tick.matches.length, 3);
      const spent = db.db.prepare("SELECT autobattle_json FROM leaders WHERE id = ?").get(d.id);
      assert.equal(JSON.parse(spent.autobattle_json).stamina, 10);
      assert.equal(JSON.parse(spent.autobattle_json).attackAt.length, 0);
      db.close();
    })();
  });

  it("runs past the old daily cap while leased", () => {
    const db = openStore(":memory:");
    const t0 = 2_000_000;
    return (async () => {
      const d = await leader(db, "restless",);
      optInAutobattle(db, d.id, t0);
      const tick = autobattleTick(db, d.id, t0 + 1, 25);
      assert.equal(tick.ran, 25);
      assert.equal(tick.stopped, "ready");
      const digest = autobattleDigest(db, d.id, t0 + 2);
      assert.equal(digest.stopReason, "ready");
      assert.equal(digest.recent.length, 10);
      assert.equal("energy" in digest, false);
      db.close();
    })();
  });

  it("pauses on demand and never renews the lease on read", () => {
    const db = openStore(":memory:");
    const t0 = 3_000_000;
    return (async () => {
      const d = await leader(db, "rest",);
      const opt = optInAutobattle(db, d.id, t0);
      pauseAutobattle(db, d.id, t0 + 1);
      const tick = autobattleTick(db, d.id, t0 + 2, 3);
      assert.equal(tick.ran, 0);
      const before = autobattleDigest(db, d.id, t0 + 3);
      const after = autobattleDigest(db, d.id, t0 + 4);
      assert.equal(before.leaseExpiresAt, opt.leaseExpiresAt);
      assert.equal(after.leaseExpiresAt, opt.leaseExpiresAt);
      assert.equal(after.stopReason, "paused");
      db.close();
    })();
  });

  it("heals the lease when a tick settle throws mid-match", () => {
    const db = openStore(":memory:");
    const t0 = 4_000_000;
    return (async () => {
      const d = await leader(db, "owner",);
      const foe = await leader(db, "ghost",);
      optInAutobattle(db, d.id, t0);
      optInAutobattle(db, foe.id, t0);
      // The foe queue picks an active version row that no longer exists.
      db.db.prepare("DELETE FROM versions WHERE id = ?").run(foe.version);
      const tick = autobattleTick(db, d.id, t0 + 1, 3);
      assert.equal(tick.ran, 0);
      assert.deepEqual(tick.matches, []);
      const st = JSON.parse(db.db.prepare("SELECT autobattle_json FROM leaders WHERE id = ?").get(d.id).autobattle_json);
      assert.equal(st.state, "ACTIVE_READY");
      const out = pauseAutobattle(db, d.id, t0 + 2);
      assert.equal(out.state, "PAUSED_MANUAL");
      db.close();
    })();
  });
});
