import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addEntry, createEvent, lock, register } from "../src/index.ts";

function open() {
  return createEvent({ id: "cup-1", seed: "s", maxPlayers: 8, minAp: 500, registrationCloseAt: 1000 });
}

describe("registration", () => {
  it("accepts a clean entry", () => {
    const out = register(open(), { leaderId: "a", agentVersionId: "v1", ap: 600, now: 10 });
    assert.equal(out.ok, true);
  });

  it("rejects a late entry", () => {
    const out = register(open(), { leaderId: "a", agentVersionId: "v1", ap: 600, now: 1001 });
    assert.equal(out.ok, false);
  });

  it("rejects a weak entry", () => {
    const out = register(open(), { leaderId: "a", agentVersionId: "v1", ap: 499, now: 10 });
    assert.equal(out.ok, false);
  });

  it("rejects a duplicate leader", () => {
    let e = open();
    e = addEntry(e, register(e, { leaderId: "a", agentVersionId: "v1", ap: 600, now: 10 }));
    const out = register(e, { leaderId: "a", agentVersionId: "v2", ap: 700, now: 11 });
    assert.equal(out.ok, false);
  });

  it("rejects a full house", () => {
    let e = open();
    for (let i = 0; i < 8; i += 1) {
      e = addEntry(e, register(e, { leaderId: `l${i}`, agentVersionId: `v${i}`, ap: 600, now: i }));
    }
    const out = register(e, { leaderId: "late", agentVersionId: "vx", ap: 900, now: 20 });
    assert.equal(out.ok, false);
  });

  it("locks versions at freeze", () => {
    let e = open();
    e = addEntry(e, register(e, { leaderId: "a", agentVersionId: "v1", ap: 600, now: 10 }));
    e = lock(e);
    assert.equal(e.entries[0].lockedVersionId, "v1");
    assert.equal(e.phase, "LOCKED");
    const out = register(e, { leaderId: "b", agentVersionId: "v2", ap: 600, now: 11 });
    assert.equal(out.ok, false);
  });
});
