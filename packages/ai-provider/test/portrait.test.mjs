import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { portraitPromptFor, PORTRAIT_STYLE } from "../src/index.ts";

// Ten house-style subjects. Each built prompt must carry the full lock:
// subject up front, style tokens intact, bounded length, no stray text.
const SUBJECTS = [
  "chrome wasp assassin",
  "rusted junkyard brawler",
  "neon chrome duelist",
  "titanium siege engine",
  "stealth matte-black infiltrator",
  "golden arena champion",
  "ice-blue scout runner",
  "plasma-forged gladiator",
  "scrapyard mongrel bot",
  "obsidian war machine",
];

describe("portrait style lock", () => {
  it("keeps all ten subjects in one art family", () => {
    assert.equal(SUBJECTS.length, 10);
    for (const subject of SUBJECTS) {
      const prompt = portraitPromptFor(subject);
      assert.ok(prompt.startsWith(subject), `subject leads: ${subject}`);
      for (const token of ["three-quarter view", "flat vector esports", "dark navy", "no text"]) {
        assert.ok(prompt.includes(token), `style holds for ${subject}: ${token}`);
      }
      assert.ok(prompt.length <= 200 + PORTRAIT_STYLE.length + 2);
    }
  });

  it("falls back to an arena robot on empty input", () => {
    for (const blank of ["", "   "]) {
      const prompt = portraitPromptFor(blank);
      assert.ok(prompt.startsWith("arena robot"));
      assert.ok(prompt.includes("three-quarter view"));
    }
  });

  it("trims a pasted novel to the subject cap", () => {
    const prompt = portraitPromptFor(`chrome wasp ${"x".repeat(500)}`);
    assert.ok(prompt.startsWith("chrome wasp"));
    assert.ok(prompt.length <= 200 + PORTRAIT_STYLE.length + 2);
  });
});
