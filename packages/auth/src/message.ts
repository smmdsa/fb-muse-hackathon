// Login message in EIP-4361 (Sign-In with Ethereum) shape. Wallets
// recognize the format and render a structured sign-in prompt
// instead of opaque text. The wallet signs it with personal_sign.
// The server rebuilds it from the stored nonce row and compares bytes.

export type LoginChallenge = {
  domain: string;
  address: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  uri?: string;
  chainId?: number;
};

export const LOGIN_STATEMENT = "Sign in to Agent Wars. This signature is free and never moves funds.";

export function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

export function buildLoginMessage(c: LoginChallenge): string {
  const uri = c.uri ?? `https://${c.domain}/auth.html`;
  const chainId = c.chainId ?? 1;
  return [
    `${c.domain} wants you to sign in with your Ethereum account:`,
    normalizeAddress(c.address),
    "",
    LOGIN_STATEMENT,
    "",
    `URI: ${uri}`,
    "Version: 1",
    `Chain ID: ${chainId}`,
    `Nonce: ${c.nonce}`,
    `Issued At: ${new Date(c.issuedAt).toISOString()}`,
    `Expiration Time: ${new Date(c.expiresAt).toISOString()}`,
  ].join("\n");
}
