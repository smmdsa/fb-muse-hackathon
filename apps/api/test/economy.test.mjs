import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../src/index.ts";
import { buildRouter } from "../src/index.ts";
import { makeCaller } from "./harness.mjs";

let store;
let call;

before(() => {
  store = openStore(":memory:");
  call = makeCaller(buildRouter({ store }));
});

async function rich(handle, ac = 500) {
  const s = await call("POST", "/v1/auth/session", { handle });
  const me = await call("GET", "/v1/me", null, s.json.token);
  store.db.prepare("UPDATE leaders SET ac = ? WHERE id = ?").run(ac, me.json.leader.id);
  return s.json.token;
}

describe("armory", () => {
  it("lists the mock catalog with wallet balances", async () => {
    const token = await rich("shopper");
    const r = await call("GET", "/v1/armory", null, token);
    assert.equal(r.status, 200);
    assert.ok(r.json.catalog.length >= 4);
    assert.equal(r.json.ac, 500);
    assert.equal(r.json.rp, 100);
    assert.equal(r.json.equipped.skin, null);
    const trail = await call("POST", "/v1/armory/buy", { itemId: "trail-spark" }, token);
    assert.equal(trail.status, 200);
    assert.equal(trail.json.rp, 80);
  });

  it("rejects unknown items and poor wallets", async () => {
    const token = await rich("broke", 0);
    const unknown = await call("POST", "/v1/armory/buy", { itemId: "skin-nope" }, token);
    assert.equal(unknown.status, 404);
    const poor = await call("POST", "/v1/armory/buy", { itemId: "skin-ember" }, token);
    assert.equal(poor.status, 422);
  });

  it("charges once and equips owned cosmetics only", async () => {
    const token = await rich("buyer");
    const first = await call("POST", "/v1/armory/buy", { itemId: "skin-ember" }, token);
    assert.equal(first.status, 200);
    assert.equal(first.json.ac, 400);
    const twice = await call("POST", "/v1/armory/buy", { itemId: "skin-ember" }, token);
    assert.equal(twice.status, 200);
    assert.equal(twice.json.ac, 400);
    const badSlot = await call("POST", "/v1/armory/equip", { slot: "engine", itemId: "skin-ember" }, token);
    assert.equal(badSlot.status, 422);
    const foreign = await call("POST", "/v1/armory/equip", { slot: "skin", itemId: "skin-tide" }, token);
    assert.equal(foreign.status, 404);
    const fit = await call("POST", "/v1/armory/equip", { slot: "skin", itemId: "skin-ember" }, token);
    assert.equal(fit.status, 200);
    assert.equal(fit.json.equipped.skin, "skin-ember");
    const again = await call("GET", "/v1/armory", null, token);
    assert.equal(again.json.equipped.skin, "skin-ember");
    assert.ok(again.json.catalog.find((c) => c.id === "skin-ember").owned);
  });
});
