import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/index.ts";
import { compileAndPublish, createAgent, runRanked } from "../src/flow.ts";

async function pair() {
  const store = openStore(":memory:");
  const mk = async (handle, prompt) => {
    store.db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run(`l-${handle}`, handle, `t-${handle}`);
    const a = await createAgent(store, {}, { leaderId: `l-${handle}`, name: handle, concept: prompt });
    const v = await compileAndPublish(store, {}, { agentId: a.agentId, prompt });
    return v.versionId;
  };
  const va = await mk("sa", "rush them down up close");
  const vb = await mk("sb", "evade and stay safe far away");
  return { store, va, vb };
}

describe("atomic settlement", () => {
  it("rolls back every write when the match insert fails", async () => {
    const { store, va, vb } = await pair();
    const before = store.db.prepare("SELECT ap FROM leaders WHERE id = 'l-sa'").get();
    const real = store.db.prepare.bind(store.db);
    store.db.prepare = ((sql) => {
      const stmt = real(sql);
      if (String(sql).startsWith("INSERT INTO matches")) {
        return { ...stmt, run: () => { throw new Error("disk gone"); } };
      }
      return stmt;
    });
    assert.throws(() => runRanked(store, { aVersionId: va, bVersionId: vb, seed: "s-1", key: "k-1" }), /disk gone/);
    store.db.prepare = real;
    const rows = store.db.prepare("SELECT * FROM matches WHERE id = 'k-1'").all();
    assert.equal(rows.length, 0);
    const after = store.db.prepare("SELECT ap FROM leaders WHERE id = 'l-sa'").get();
    assert.deepEqual(after, before);
    const keys = store.db.prepare("SELECT * FROM wallet_keys WHERE key LIKE 'k-1%'").all();
    assert.equal(keys.length, 0);
  });

  it("settles a dual invocation once", async () => {
    const { store, va, vb } = await pair();
    const [r1, r2] = await Promise.all([
      (async () => runRanked(store, { aVersionId: va, bVersionId: vb, seed: "s-2", key: "k-2" }))(),
      (async () => runRanked(store, { aVersionId: va, bVersionId: vb, seed: "s-2", key: "k-2" }))(),
    ]);
    assert.equal(r1.matchId, "k-2");
    assert.equal(r2.matchId, "k-2");
    const rows = store.db.prepare("SELECT * FROM matches WHERE id = 'k-2'").all();
    assert.equal(rows.length, 1);
  });
});
