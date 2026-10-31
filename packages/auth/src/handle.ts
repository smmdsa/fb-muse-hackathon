// Handle rules. One lowercase word, index-friendly. Both runtimes
// and the page share this shape; the UNIQUE index wins every race.

const HANDLE_RE = /^[a-z][a-z0-9_]{2,15}$/;

const RESERVED = new Set([
  "admin",
  "administrator",
  "agentwars",
  "api",
  "mod",
  "moderator",
  "null",
  "official",
  "support",
  "system",
  "undefined",
  "wallet",
]);

export function normalizeHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().toLowerCase();
  return name ? name : null;
}

// Null means valid. Anything else is the human reason it is not.
export function handleError(name: string): string | null {
  if (!HANDLE_RE.test(name)) return "use 3-16 chars: a-z, 0-9, underscore, starting with a letter";
  if (RESERVED.has(name)) return "that name is reserved";
  return null;
}
