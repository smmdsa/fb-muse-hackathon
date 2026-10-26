import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addEntry, createEvent, lock, register, reportGame, seedBracket } from "../src/index.ts";

function fullHouse(seed = "cup-seed") {
  let e = createEvent({ id: "cup-1", seed, maxPlayers: 8, minAp: 0, registrationCloseAt: 1000 });
  for (let i = 0; i < 8; i += 1) {
    e = addEntry(e, register(e, { leaderId: `l${i}`, agentVersionId: `v${i}`, ap: 100, now: i }));
  }
  return lock(e);
}

function playAll(e) {
  let cur = seedBracket(e);
  while (cur.phase !== "COMPLETED") {
    const slot = cur.bracket.slots.find((s) => s.winnerId === null && s.slotA && s.slotB);
    const need = Math.ceil(slot.bestOf / 2);
    for (let g = 0; g < need; g += 1) {
      cur = reportGame(cur, { slotId: slot.id, winnerVersionId: slot.slotA });
    }
  }
  return cur;
}

describe("bracket", () => {
  it("draws the same bracket from the same seed", () => {
    const a = seedBracket(fullHouse("same"));
    const b = seedBracket(fullHouse("same"));
    assert.deepEqual(
      a.bracket.slots.map((s) => [s.slotA, s.slotB]),
      b.bracket.slots.map((s) => [s.slotA, s.slotB]),
    );
  });

  it("builds 7 slots with a best-of-3 final", () => {
    const e = seedBracket(fullHouse());
    assert.equal(e.bracket.slots.length, 7);
    const finals = e.bracket.slots.filter((s) => s.round === 3);
    assert.equal(finals.length, 1);
    assert.equal(finals[0].bestOf, 3);
  });

  it("crowns a champion after a full playthrough", () => {
    const done = playAll(fullHouse());
    assert.equal(done.phase, "COMPLETED");
    assert.ok(done.bracket.championId);
  });

  it("needs 2 game wins in the final", () => {
    let cur = seedBracket(fullHouse());
    while (true) {
      const slot = cur.bracket.slots.find((s) => s.winnerId === null && s.slotA && s.slotB);
      if (slot.round === 3) break;
      cur = reportGame(cur, { slotId: slot.id, winnerVersionId: slot.slotA });
    }
    const final = cur.bracket.slots.find((s) => s.round === 3);
    cur = reportGame(cur, { slotId: final.id, winnerVersionId: final.slotA });
    const afterOne = cur.bracket.slots.find((s) => s.id === final.id);
    assert.equal(afterOne.winnerId, null);
    assert.equal(cur.phase, "LIVE");
    cur = reportGame(cur, { slotId: final.id, winnerVersionId: final.slotA });
    assert.equal(cur.phase, "COMPLETED");
  });

  it("rejects a decided slot and a foreign winner", () => {
    let cur = seedBracket(fullHouse());
    const slot = cur.bracket.slots[0];
    cur = reportGame(cur, { slotId: slot.id, winnerVersionId: slot.slotA });
    assert.throws(() => reportGame(cur, { slotId: slot.id, winnerVersionId: slot.slotA }), /already decided/);
    const other = cur.bracket.slots.find((s) => s.winnerId === null && s.slotA && s.slotB);
    assert.throws(() => reportGame(cur, { slotId: other.id, winnerVersionId: "ghost" }), /not in this slot/);
  });

  it("refuses a house that is not a power of two", () => {
    let e = createEvent({ id: "cup-2", seed: "x", maxPlayers: 8, minAp: 0, registrationCloseAt: 1000 });
    for (let i = 0; i < 7; i += 1) {
      e = addEntry(e, register(e, { leaderId: `l${i}`, agentVersionId: `v${i}`, ap: 100, now: i }));
    }
    assert.throws(() => seedBracket(lock(e)), /power-of-two/);
  });
});
