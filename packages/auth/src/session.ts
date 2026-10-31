// Cookie sessions. The cookie carries an opaque token; only its
// sha256 lives in the database, so a dump never yields sessions.

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export const SESSION_COOKIE = "aw_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const NONCE_TTL_MS = 5 * 60 * 1000;

export function hashToken(token: string): string {
  return bytesToHex(sha256(utf8ToBytes(token)));
}

export function buildSetCookie(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

export function buildClearCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    out[name] = part.slice(eq + 1).trim();
  }
  return out;
}

export function readSessionCookie(header: string | null | undefined): string | null {
  const token = parseCookies(header)[SESSION_COOKIE];
  return token ? token : null;
}
