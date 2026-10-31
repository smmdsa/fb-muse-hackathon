// Login message. The wallet signs this exact text with personal_sign.
// The server rebuilds it from the stored nonce row and compares bytes.

export type LoginChallenge = {
  domain: string;
  address: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

export function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

export function buildLoginMessage(c: LoginChallenge): string {
  return [
    "Agent Wars login",
    "",
    `Domain: ${c.domain}`,
    `Address: ${normalizeAddress(c.address)}`,
    `Nonce: ${c.nonce}`,
    `Issued: ${new Date(c.issuedAt).toISOString()}`,
    `Expires: ${new Date(c.expiresAt).toISOString()}`,
  ].join("\n");
}
