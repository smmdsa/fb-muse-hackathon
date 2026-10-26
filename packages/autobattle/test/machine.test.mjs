import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  activate,
  draft,
  enterTournament,
  exitTournament,
  finishMatch,
  pause,
  recordDefense,
  refresh,
  startOwnerMatch,
  LEASE_MS,
  REGEN_MS,
  DAY_MS,
} from "../src/index.ts";

const H = 60 * 60 * 1000;

function live(now = 0) {
  const d = draft("leader-1", now);
  d.published = true;
  return activate(d, now);
}

describe("lease", () => {
  it("stays ready inside 24 hours", () => {
    const s = refresh(live(0), 23 * H);
    assert.equal(s.state, "ACTIVE_READY");
  });

  it("expires new matches at 24 hours but a read never renews", () => {
    let s = live(0);
    s = refresh(s, 24 * H);
    assert.equal(s.state, "IDLE_EXPIRED");
    const attempt = startOwnerMatch(s, 24 * H);
    assert.equal(attempt.guard.ok, false);
    s = refresh(s, 30 * H);
    assert.equal(s.leaseExpiresAt, 24 * H);
  });

  it("lets an in-progress match finish, then expiry applies", () => {
    let s = live(0);
    s = startOwnerMatch(s, 23 * H).status;
    assert.equal(s.state, "IN_MATCH");
    s = refresh(s, 25 * H);
    assert.equal(s.state, "IN_MATCH");
    s = finishMatch(s, 25 * H);
    assert.equal(s.state, "IDLE_EXPIRED");
  });

  it("reactivation renews the lease", () => {
    let s = refresh(live(0), 30 * H);
    assert.equal(s.state, "IDLE_EXPIRED");
    s = activate(s, 30 * H);
    assert.equal(s.leaseExpiresAt, 30 * H + LEASE_MS);
    assert.equal(s.state, "ACTIVE_READY");
  });
});

describe("stamina", () => {
  it("spends one charge per owner match", () => {
    let s = live(0);
    s = startOwnerMatch(s, 0).status;
    assert.equal(s.stamina, 9);
    s = finishMatch(s, 0);
    assert.equal(s.state, "ACTIVE_READY");
  });

  it("blocks at zero and refills 1 per 2 hours", () => {
    let s = live(0);
    for (let i = 0; i < 10; i += 1) {
      s = startOwnerMatch(s, i).status;
      s = finishMatch(s, i);
    }
    assert.equal(s.stamina, 0);
    const denied = startOwnerMatch(s, 10);
    assert.equal(denied.guard.ok, false);
    assert.equal(denied.status.state, "IDLE_ENERGY");
    s = refresh(denied.status, 10 + 4 * H);
    assert.equal(s.stamina, 2);
    assert.equal(s.state, "ACTIVE_READY");
  });

  it("caps at 10 and never resumes after expiry", () => {
    let s = live(0);
    s = refresh(s, 30 * H);
    assert.equal(s.stamina, 10);
    assert.equal(s.state, "IDLE_EXPIRED");
    const attempt = startOwnerMatch(s, 30 * H);
    assert.equal(attempt.guard.ok, false);
  });

  it("caps attacks at 10 per day", () => {
    let s = live(0);
    for (let i = 0; i < 10; i += 1) {
      const r = startOwnerMatch(s, i * 1000);
      assert.equal(r.guard.ok, true);
      s = finishMatch(r.status, i * 1000);
    }
    const over = startOwnerMatch(s, 11 * 1000);
    assert.equal(over.guard.ok, false);
  });
});

describe("defense and flags", () => {
  it("credits 3 defenses per day, then runs unranked", () => {
    let s = live(0);
    const flags = [];
    for (let i = 0; i < 4; i += 1) {
      const r = recordDefense(s, i * H);
      s = r.status;
      flags.push(r.credited);
    }
    assert.deepEqual(flags, [true, true, true, false]);
  });

  it("denies credit after lease expiry", () => {
    let s = live(0);
    const r = recordDefense(s, 30 * H);
    assert.equal(r.credited, false);
  });

  it("pauses and needs explicit activation", () => {
    let s = live(0);
    s = pause(s);
    assert.equal(s.state, "PAUSED_MANUAL");
    s = refresh(s, 5 * H);
    assert.equal(s.state, "PAUSED_MANUAL");
  });

  it("freezes for tournaments without stamina", () => {
    let s = live(0);
    const before = s.stamina;
    s = enterTournament(s, H);
    assert.equal(s.state, "TOURNAMENT_LOCKED");
    s = exitTournament(s, 2 * H);
    assert.equal(s.state, "ACTIVE_READY");
    assert.equal(s.stamina, before);
  });

  it("prunes day windows with rolling time", () => {
    let s = live(0);
    for (let i = 0; i < 10; i += 1) {
      const r = startOwnerMatch(s, i * 1000);
      s = finishMatch(r.status, i * 1000);
    }
    s = refresh(s, 2 * DAY_MS);
    assert.equal(s.attackAt.length, 0);
    s = activate(s, 2 * DAY_MS);
    const r = startOwnerMatch(s, 2 * DAY_MS);
    assert.equal(r.guard.ok, true);
  });
});
