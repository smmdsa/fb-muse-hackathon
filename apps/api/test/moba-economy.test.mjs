// MOBA economy isolation. Spec sections 6.1, 6.5, 6.6, 8, 13 and check T3.2.
// Post-match AC payouts stay identical to duel paths. Match gold never
// touches the AC wallet. Buy and combine paths never call economy APIs.
// Static checks below mirror this grep (run from the repo root):
//   rg -i "gold" apps/api/src ; rg "economy|earnAc|createWallet|wallet|AC_WIN|AC_LOSS" packages/battle-core/src
// Both greps must print nothing.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openStore, creditAc } from "../src/index.ts";
import {
  AC_DAILY_CAP,
  AC_LOSS,
  AC_WIN,
  CATALOG,
  createWallet,
  earnAc,
} from "@agent-wars/economy";
import {
  ALL_ITEM_IDS,
  BASE_ITEMS,
  BENCH_POLICY,
  CASTER_GOLD,
  DEFAULT_MOBA,
  MELEE_GOLD,
  MOBA_START_GOLD,
  RECIPES,
  ROBOT_GOLD,
  fightPolicies,
  planBuy,
} from "@agent-wars/battle-core";

const MATCH_GOLD_FIGURES = new Set([
  MOBA_START_GOLD,
  MELEE_GOLD,
  CASTER_GOLD,
  ROBOT_GOLD,
  ...Object.values(BASE_ITEMS).map((b) => b.cost),
  ...RECIPES.map((r) => r.fee),
  ...RECIPES.map((r) => planBuy(r.id, []).cost),
]);

function seedLeader(store, id, handle) {
  store.db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run(id, handle, `t-${handle}`);
}

function txnsFor(store, walletId) {
  return store.db.prepare("SELECT * FROM wallet_txns WHERE wallet_id = ? ORDER BY seq").all(walletId);
}

function keysFor(store, walletId) {
  return store.db.prepare("SELECT key FROM wallet_keys WHERE wallet_id = ?").all(walletId).map((r) => r.key);
}

describe("moba AC payouts match duel amounts", () => {
  it("pins the duel payout constants", () => {
    assert.equal(AC_WIN, 25);
    assert.equal(AC_LOSS, 10);
    assert.equal(AC_DAILY_CAP, 150);
  });

  it("earnAc pays win 25, loss 10, no-contest 0", () => {
    const w = createWallet("moba-w");
    assert.deepEqual(
      earnAc(w, { key: "moba-win", kind: "win", suspicious: false, now: 0 }),
      { credited: 25, capped: false, keyUsed: false },
    );
    assert.deepEqual(
      earnAc(w, { key: "moba-loss", kind: "loss", suspicious: false, now: 1 }),
      { credited: 10, capped: false, keyUsed: false },
    );
    assert.equal(earnAc(w, { key: "moba-nc", kind: "no-contest", suspicious: false, now: 2 }).credited, 0);
    assert.equal(earnAc(w, { key: "moba-sus", kind: "win", suspicious: true, now: 3 }).credited, 0);
    assert.equal(w.ac, 35);
  });

  it("creditAc settles each kind with the duel amount", () => {
    const store = openStore(":memory:");
    try {
      seedLeader(store, "l-a", "moba-a");
      assert.equal(creditAc(store, "l-a", "m-key", "a", "win"), 25);
      assert.equal(creditAc(store, "l-a", "m-key2", "a", "loss"), 10);
      assert.equal(creditAc(store, "l-a", "m-key3", "a", "no-contest"), 0);
      const row = store.db.prepare("SELECT ac FROM leaders WHERE id = ?").get("l-a");
      assert.equal(row.ac, 35);
      const txns = txnsFor(store, "l-a");
      assert.deepEqual(txns.map((t) => t.delta), [25, 10, 0]);
      assert.deepEqual(txns.map((t) => t.reason), ["match win", "match loss", "no-pay no-contest"]);
      assert.deepEqual(keysFor(store, "l-a").sort(), ["m-key-a", "m-key2-a", "m-key3-a"]);
    } finally {
      store.close();
    }
  });
});

describe("moba match gold never touches the AC wallet", () => {
  let store;
  let fight;

  before(() => {
    store = openStore(":memory:");
    seedLeader(store, "l-ma", "moba-ma");
    seedLeader(store, "l-mb", "moba-mb");
    const cfg = { ...DEFAULT_MOBA, seed: "moba-econ-1" };
    fight = fightPolicies(BENCH_POLICY, BENCH_POLICY, "moba-econ-1", cfg);
    assert.equal(typeof fight.winner, "string");
    assert.ok(fight.ticks > 0);
  });

  it("settles a completed MOBA fight with duel amounts only", () => {
    const winner = fight.winner;
    const kindA = winner === "A" ? "win" : winner === "B" ? "loss" : "no-contest";
    const kindB = winner === "B" ? "win" : winner === "A" ? "loss" : "no-contest";
    const paidA = creditAc(store, "l-ma", "moba-econ-1", "a", kindA);
    const paidB = creditAc(store, "l-mb", "moba-econ-1", "b", kindB);
    const want = (k) => (k === "win" ? 25 : k === "loss" ? 10 : 0);
    assert.equal(paidA, want(kindA));
    assert.equal(paidB, want(kindB));
  });

  it("holds no match-gold entry in keys or txns", () => {
    for (const id of ["l-ma", "l-mb"]) {
      assert.deepEqual(keysFor(store, id), [`moba-econ-1-${id === "l-ma" ? "a" : "b"}`]);
      const txns = txnsFor(store, id);
      assert.equal(txns.length, 1);
      for (const t of txns) {
        assert.ok([25, 10, 0].includes(t.delta));
        assert.ok(!MATCH_GOLD_FIGURES.has(t.delta), `txn delta ${t.delta} must not be a match-gold figure`);
        assert.match(t.reason, /^(match (win|loss)|no-pay no-contest)$/);
        assert.equal(t.currency, "AC");
      }
      const row = store.db.prepare("SELECT ac FROM leaders WHERE id = ?").get(id);
      assert.equal(row.ac, txns[0].delta);
    }
  });

  it("keeps armory goods disjoint from MOBA items: no AC cost for items", () => {
    const mobaIds = new Set(ALL_ITEM_IDS);
    for (const c of CATALOG) {
      assert.ok(!mobaIds.has(c.id), `armory item ${c.id} must not be a MOBA item`);
    }
  });
});

describe("buy and combine paths never call economy APIs", () => {
  const battleSrc = (name) =>
    readFileSync(new URL(`../../../packages/battle-core/src/${name}`, import.meta.url), "utf8");
  const apiSrc = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

  it("imports no economy module from battle-core", () => {
    const files = ["index.ts", "items.ts", "moba.ts", "policies.ts", "policy-driver.ts", "rng.ts", "simulation.ts", "types.ts", "world.ts"];
    const banned = ["@agent-wars/economy", "earnAc", "createWallet", "purchaseWithRealMoney", "AC_WIN", "AC_LOSS", "AC_DAILY_CAP"];
    for (const f of files) {
      const body = battleSrc(f);
      assert.ok(!/from\s+["']@agent-wars\/economy["']/.test(body), `${f} must not import the economy package`);
      for (const token of banned) {
        assert.ok(!body.includes(token), `${f} must not mention ${token}`);
      }
      assert.ok(!/\bwallets?\b/i.test(body), `${f} must not mention wallets`);
    }
  });

  it("routes no match gold through the api settle path", () => {
    for (const f of ["flow.ts", "worker.ts", "server.ts", "store.ts", "ids.ts", "index.ts", "dev.mjs"]) {
      const body = apiSrc(f);
      assert.ok(!/gold/i.test(body), `${f} must not mention gold`);
    }
  });
});
