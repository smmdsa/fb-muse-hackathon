import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addressOfSecret,
  buildClearCookie,
  buildLoginMessage,
  buildSetCookie,
  isAddress,
  NONCE_TTL_MS,
  parseCookies,
  readSessionCookie,
  recoverAddress,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  signLoginMessage,
  verifyWalletSignature,
} from "../src/index.ts";

// Hardhat test key #0. Public, holds nothing. Its address pins Ethereum compat.
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

const challenge = {
  domain: "127.0.0.1:8787",
  address: TEST_ADDRESS,
  nonce: "nonce_abc123",
  issuedAt: 1_700_000_000_000,
  expiresAt: 1_700_000_000_000 + NONCE_TTL_MS,
};

describe("wallet auth", () => {
  it("derives the known test address", () => {
    assert.equal(addressOfSecret(TEST_KEY), TEST_ADDRESS);
  });

  it("builds an EIP-4361 message with every challenge field", () => {
    const text = buildLoginMessage({ ...challenge, address: TEST_ADDRESS.toUpperCase().replace("0X", "0x") });
    assert.ok(text.startsWith("127.0.0.1:8787 wants you to sign in with your Ethereum account:"));
    assert.ok(text.includes(TEST_ADDRESS));
    assert.ok(text.includes("Sign in to Agent Wars. This signature is free and never moves funds."));
    assert.ok(text.includes("URI: https://127.0.0.1:8787/auth.html"));
    assert.ok(text.includes("Version: 1"));
    assert.ok(text.includes("Chain ID: 1"));
    assert.ok(text.includes("Nonce: nonce_abc123"));
    assert.ok(text.includes("Issued At: "));
    assert.ok(text.includes("Expiration Time: "));
  });

  it("signs and recovers the signer", () => {
    const text = buildLoginMessage(challenge);
    const sig = signLoginMessage(text, TEST_KEY);
    assert.match(sig, /^0x[0-9a-f]{130}$/);
    assert.equal(recoverAddress(text, sig), TEST_ADDRESS);
    assert.equal(verifyWalletSignature(text, sig, TEST_ADDRESS), true);
  });

  it("rejects the wrong address", () => {
    const text = buildLoginMessage(challenge);
    const sig = signLoginMessage(text, TEST_KEY);
    assert.equal(verifyWalletSignature(text, sig, "0x0000000000000000000000000000000000000001"), false);
    assert.equal(verifyWalletSignature(text, sig, "not-an-address"), false);
  });

  it("rejects a tampered message", () => {
    const text = buildLoginMessage(challenge);
    const sig = signLoginMessage(text, TEST_KEY);
    assert.notEqual(recoverAddress(text + " ", sig), TEST_ADDRESS);
    assert.notEqual(recoverAddress(text.replace("127.0.0.1", "evil.example"), sig), TEST_ADDRESS);
  });

  it("rejects malformed signatures", () => {
    const text = buildLoginMessage(challenge);
    assert.equal(recoverAddress(text, "0x1234"), null);
    assert.equal(recoverAddress(text, "zz"), null);
    const sig = signLoginMessage(text, TEST_KEY);
    const badV = sig.slice(0, -2) + "ff";
    assert.equal(recoverAddress(text, badV), null);
  });

  it("accepts v in 0/1 form too", () => {
    const text = buildLoginMessage(challenge);
    const sig = signLoginMessage(text, TEST_KEY);
    const v = Number.parseInt(sig.slice(-2), 16) - 27;
    const raw = sig.slice(0, -2) + v.toString(16).padStart(2, "0");
    assert.equal(recoverAddress(text, raw), TEST_ADDRESS);
  });

  it("round-trips the session cookie", () => {
    const set = buildSetCookie("sess_abc");
    assert.ok(set.startsWith(`${SESSION_COOKIE}=sess_abc`));
    assert.ok(set.includes("HttpOnly"));
    assert.ok(set.includes("SameSite=Lax"));
    assert.ok(set.includes(`Max-Age=${SESSION_TTL_MS / 1000}`));
    assert.equal(readSessionCookie(`other=1; ${SESSION_COOKIE}=sess_abc`), "sess_abc");
    assert.equal(readSessionCookie(null), null);
    assert.deepEqual(parseCookies("a=1; a=2"), { a: "1" });
    assert.ok(buildClearCookie().includes("Max-Age=0"));
  });

  it("validates addresses", () => {
    assert.equal(isAddress(TEST_ADDRESS), true);
    assert.equal(isAddress("0x123"), false);
    assert.equal(isAddress("f39fd6e51aad88f6f4ce6ab8827279cfffb92266"), false);
  });
});
