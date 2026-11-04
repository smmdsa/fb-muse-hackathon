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
  refundManualMatch,
  spendManualMatch,
  startOwnerMatch,
  LEASE_MS,
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

  it("stores the mode and keeps it past pause", () => {
    let s = activate({ ...draft("leader-1", 0), published: true }, 0, "ranked");
    assert.equal(s.autoMode, "ranked");
    s = pause(s);
    assert.equal(s.autoMode, "ranked");
    s = activate(s, 1000);
    assert.equal(s.autoMode, "casual");
  });

  it("reactivation renews the lease", () => {
    let s = refresh(live(0), 30 * H);
    assert.equal(s.state, "IDLE_EXPIRED");
    s = activate(s, 30 * H);
    assert.equal(s.leaseExpiresAt, 30 * H + LEASE_MS);
    assert.equal(s.state, "ACTIVE_READY");
  });
});

describe("free fights", () => {
  it("runs owner matches at no cost and off the daily count", () => {
    let s = live(0);
    s = startOwnerMatch(s, 0).status;
    assert.equal(s.stamina, 10);
    assert.equal(s.attackAt.length, 0);
    s = finishMatch(s, 0);
    assert.equal(s.state, "ACTIVE_READY");
  });

  it("runs past 10 owner matches a day inside the lease", () => {
    let s = live(0);
    for (let i = 0; i < 25; i += 1) {
      const r = startOwnerMatch(s, i * 1000);
      assert.equal(r.guard.ok, true);
      s = finishMatch(r.status, i * 1000);
    }
    assert.equal(s.state, "ACTIVE_READY");
  });

  it("still blocks after expiry", () => {
    let s = live(0);
    s = refresh(s, 30 * H);
    assert.equal(s.state, "IDLE_EXPIRED");
    const attempt = startOwnerMatch(s, 30 * H);
    assert.equal(attempt.guard.ok, false);
  });
});

describe("manual matches", () => {
  it("runs free with no lease or opt-in", () => {
    const d = draft("leader-1", 0);
    d.published = true;
    const r = spendManualMatch(d, 1000);
    assert.equal(r.guard.ok, true);
    assert.equal(r.status.stamina, 10);
    assert.equal(r.status.attackAt.length, 1);
  });

  it("denies drafts with no published version", () => {
    const r = spendManualMatch(draft("leader-1", 0), 1000);
    assert.equal(r.guard.ok, false);
  });

  it("refunds a reservation without starting a fight", () => {
    const d = { ...draft("leader-1", 0), published: true };
    const spent = spendManualMatch(d, 1000).status;
    assert.equal(spent.attackAt.length, 1);
    const back = refundManualMatch(spent, 2000);
    assert.equal(back.attackAt.length, 0);
  });

  it("caps manual fights at 10 per day", () => {
    let s = { ...draft("leader-1", 0), published: true };
    for (let i = 0; i < 10; i += 1) s = spendManualMatch(s, i * 1000).status;
    const over = spendManualMatch(s, 11 * 1000);
    assert.equal(over.guard.ok, false);
    assert.equal(over.guard.reason, "daily match cap reached");
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

  it("freezes for tournaments and costs nothing", () => {
    let s = live(0);
    s = enterTournament(s, H);
    assert.equal(s.state, "TOURNAMENT_LOCKED");
    s = exitTournament(s, 2 * H);
    assert.equal(s.state, "ACTIVE_READY");
    assert.equal(s.stamina, 10);
  });

  it("prunes day windows with rolling time", () => {
    let s = live(0);
    for (let i = 0; i < 10; i += 1) {
      s = spendManualMatch(s, i * 1000).status;
    }
    assert.equal(spendManualMatch(s, 11 * 1000).guard.ok, false);
    s = refresh(s, 2 * DAY_MS);
    assert.equal(s.attackAt.length, 0);
  });
});
