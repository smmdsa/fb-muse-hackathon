import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { openStore, buildRouter } from "../src/index.ts";
import { compileAndPublish, createAgent, installVersion } from "../src/flow.ts";
import { makeCaller } from "./harness.mjs";

process.env.ADMIN_KEY = "test-admin";

let call;
let store;
const ADMIN = { "x-admin-key": "test-admin" };
const PROMPTS = ["rush them down up close", "evade and stay far away"];
let promptNo = 0;

async function leader(handle) {
  store.db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run(`l-${handle}`, handle, `t-${handle}`);
  const a = await createAgent(store, {}, { leaderId: `l-${handle}`, name: handle, concept: "admin cup" });
  const v = await compileAndPublish(store, {}, { agentId: a.agentId, prompt: PROMPTS[promptNo++ % PROMPTS.length] });
  installVersion(store, { leaderId: `l-${handle}`, agentId: a.agentId, versionId: v.versionId });
  return { id: `l-${handle}`, token: `t-${handle}`, version: v.versionId };
}

function draftPayload(id, maxPlayers = 2) {
  return { id, name: `Cup ${id}`, maxPlayers, minAp: 0, registrationCloseAt: Date.now() + 86_400_000 };
}

before(() => {
  store = openStore(":memory:");
  call = makeCaller(buildRouter({ store }));
});

describe("organizer admin", () => {
  it("locks the console with no key", async () => {
    process.env.ADMIN_KEY = "";
    const r = await call("POST", "/v1/admin/events", draftPayload("no-key-cup"), null, {});
    assert.equal(r.status, 503);
    process.env.ADMIN_KEY = "test-admin";
  });

  it("rejects a wrong key and a leader token", async () => {
    const wrong = await call("POST", "/v1/admin/events", draftPayload("bad-key-cup"), null, { "x-admin-key": "nope" });
    assert.equal(wrong.status, 401);
    const s = await call("POST", "/v1/auth/session", { handle: "not-admin" });
    const bare = await call("POST", "/v1/admin/events", draftPayload("bare-cup"), s.json.token, {});
    assert.equal(bare.status, 401);
  });

  it("creates a draft event", async () => {
    const r = await call("POST", "/v1/admin/events", draftPayload("cup-2"), null, ADMIN);
    assert.equal(r.status, 201);
    assert.equal(r.json.phase, "DRAFT");
    assert.equal(r.json.maxPlayers, 2);
  });

  it("rejects bad slugs, dupes, and odd sizes", async () => {
    const slug = await call("POST", "/v1/admin/events", draftPayload("NOPE!"), null, ADMIN);
    assert.equal(slug.status, 422);
    const dupe = await call("POST", "/v1/admin/events", draftPayload("cup-2"), null, ADMIN);
    assert.equal(dupe.status, 422);
    const odd = await call("POST", "/v1/admin/events", { ...draftPayload("cup-3"), maxPlayers: 3 }, null, ADMIN);
    assert.equal(odd.status, 422);
  });

  it("denies registration before the event opens", async () => {
    const d = await leader("early-bird");
    const r = await call("POST", "/v1/tournaments/cup-2/register", { versionId: d.version }, d.token);
    assert.equal(r.status, 404);
    assert.match(r.json.error, /phase DRAFT/);
  });

  it("denies jumps and unknown targets", async () => {
    const jump = await call("POST", "/v1/admin/events/cup-2/transition", { to: "LIVE" }, null, ADMIN);
    assert.equal(jump.status, 422);
    const ghost = await call("POST", "/v1/admin/events/ghost/transition", { to: "LIVE" }, null, ADMIN);
    assert.equal(ghost.status, 404);
    const bogus = await call("POST", "/v1/admin/events/cup-2/transition", { to: "MEGA" }, null, ADMIN);
    assert.equal(bogus.status, 422);
  });

  it("walks DRAFT to COMPLETED with a frozen bracket", async () => {
    const a = await leader("org-a");
    const b = await leader("org-b");
    for (const to of ["ANNOUNCED", "REGISTRATION_OPEN"]) {
      const r = await call("POST", "/v1/admin/events/cup-2/transition", { to }, null, ADMIN);
      assert.equal(r.status, 200);
      assert.equal(r.json.phase, to);
    }
    const regs = [];
    for (const d of [a, b]) {
      const reg = await call("POST", "/v1/tournaments/cup-2/register", { versionId: d.version }, d.token);
      assert.equal(reg.status, 201);
      regs.push(reg);
    }
    assert.equal(regs[1].json.started, true);
    assert.equal(regs[1].json.event.phase, "SEEDED");
    assert.equal(regs[1].json.event.entries[0].lockedVersionId, a.version);
    const live = await call("POST", "/v1/admin/events/cup-2/transition", { to: "LIVE" }, null, ADMIN);
    assert.equal(live.status, 200);
    assert.equal(live.json.phase, "LIVE");
    assert.ok(live.json.bracket);
    assert.equal(live.json.bracket.slots.length, 1);
    const done = await call("POST", "/v1/admin/events/cup-2/transition", { to: "COMPLETED" }, null, ADMIN);
    assert.equal(done.status, 200);
    assert.equal(done.json.phase, "COMPLETED");
    const late = await call("POST", "/v1/admin/events/cup-2/transition", { to: "LIVE" }, null, ADMIN);
    assert.equal(late.status, 422);
  });

  it("locks early, then seeds on the way live", async () => {
    await call("POST", "/v1/admin/events", draftPayload("cup-4", 4), null, ADMIN);
    for (const to of ["ANNOUNCED", "REGISTRATION_OPEN"]) {
      await call("POST", "/v1/admin/events/cup-4/transition", { to }, null, ADMIN);
    }
    const a = await leader("early-a");
    const b = await leader("early-b");
    for (const d of [a, b]) {
      const reg = await call("POST", "/v1/tournaments/cup-4/register", { versionId: d.version }, d.token);
      assert.equal(reg.status, 201);
      assert.equal(reg.json.started, false);
    }
    const locked = await call("POST", "/v1/admin/events/cup-4/transition", { to: "LOCKED" }, null, ADMIN);
    assert.equal(locked.status, 200);
    assert.equal(locked.json.entries[1].lockedVersionId, b.version);
    const live = await call("POST", "/v1/admin/events/cup-4/transition", { to: "LIVE" }, null, ADMIN);
    assert.equal(live.status, 200);
    assert.equal(live.json.phase, "LIVE");
    assert.equal(live.json.bracket.slots.length, 1);
  });

  it("refuses the lock below two entries", async () => {
    await call("POST", "/v1/admin/events", draftPayload("tiny-cup"), null, ADMIN);
    await call("POST", "/v1/admin/events/tiny-cup/transition", { to: "ANNOUNCED" }, null, ADMIN);
    await call("POST", "/v1/admin/events/tiny-cup/transition", { to: "REGISTRATION_OPEN" }, null, ADMIN);
    const d = await leader("lonely");
    await call("POST", "/v1/tournaments/tiny-cup/register", { versionId: d.version }, d.token);
    const locked = await call("POST", "/v1/admin/events/tiny-cup/transition", { to: "LOCKED" }, null, ADMIN);
    assert.equal(locked.status, 422);
    assert.match(locked.json.error, /two entries/);
  });
});
