import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import entry from "../src/worker.ts";

// A D1-shaped shim over node:sqlite. Same SQL, same call shape.
function shim(db) {
  return {
    prepare: (query) => ({
      bind: (...values) => ({
        first: async () => db.prepare(query).get(...values) ?? null,
        all: async () => ({ results: db.prepare(query).all(...values) }),
        run: async () => db.prepare(query).run(...values),
      }),
    }),
  };
}

let env;

before(() => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../../../migrations/0001_schema.sql", import.meta.url), "utf8"));
  db.prepare("INSERT INTO leaders (id, handle, token, rating_milli, ap, placement, placed) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "l1", "commander", "t1", 1020000, 520, 5, 1,
  );
  env = { DB: shim(db) };
});

describe("worker reads", () => {
  it("answers health", async () => {
    const res = await entry.fetch(new Request("http://local/v1/health"), env);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });

  it("lists the board from D1 rows", async () => {
    const res = await entry.fetch(new Request("http://local/v1/leaderboard"), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.rows.map((r) => r.leaderId), ["l1"]);
  });

  it("404s unknown routes", async () => {
    const res = await entry.fetch(new Request("http://local/v1/secret"), env);
    assert.equal(res.status, 404);
  });
});
