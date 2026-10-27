// Opaque ids and tokens. Crypto randomness everywhere: Date-based ids
// and Math.random tokens are guessable and stay out of this file.
// getRandomValues exists in node and workers with no import.

function hex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return [...buf].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Ids keep a time prefix for ordering plus 64 random bits.
export function mintId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${hex(8)}`;
}

// Tokens carry 128 random bits. The prefix only labels the kind.
export function newToken(kind: string): string {
  return `${kind}_${hex(16)}`;
}

// Sliding-window throttle. True means allowed; the hit is recorded.
// Callers hold one map per route. Memory-only: a restart clears history.
export function checkLimit(log: Map<string, number[]>, key: string, now: number, windowMs: number, max: number): boolean {
  const hits = (log.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    log.set(key, hits);
    return false;
  }
  hits.push(now);
  log.set(key, hits);
  return true;
}
