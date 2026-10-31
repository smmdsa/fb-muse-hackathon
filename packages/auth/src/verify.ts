// Wallet signature check. Recovers the signer with secp256k1 and
// compares it to the claimed address. Workers-safe: noble only.

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { isAddress, normalizeAddress } from "./message.ts";

// EIP-191 personal_sign envelope. Wallets sign this hash, not the text.
export function personalHash(message: string): Uint8Array {
  const body = utf8ToBytes(message);
  const prefix = utf8ToBytes(`\u0019Ethereum Signed Message:\n${body.length}`);
  const out = new Uint8Array(prefix.length + body.length);
  out.set(prefix, 0);
  out.set(body, prefix.length);
  return keccak_256(out);
}

function uncompressed(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length === 33) return secp256k1.Point.fromBytes(publicKey).toBytes(false);
  if (publicKey.length === 65 && publicKey[0] === 0x04) return publicKey;
  if (publicKey.length === 64) return publicKey;
  throw new Error("bad public key length");
}

function addressOf(publicKey: Uint8Array): string {
  const full = uncompressed(publicKey);
  const raw = full.length === 65 ? full.slice(1) : full;
  return "0x" + bytesToHex(keccak_256(raw).slice(12, 32));
}

// Recovers the signer address, or null when the signature is unusable.
export function recoverAddress(message: string, signature: string): string | null {
  try {
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return null;
    const bytes = hexToBytes(signature.slice(2));
    const v = bytes[64];
    const recovery = v === 27 || v === 28 ? v - 27 : v === 0 || v === 1 ? v : -1;
    if (recovery < 0) return null;
    const recovered = new Uint8Array(65);
    recovered[0] = recovery;
    recovered.set(bytes.slice(0, 64), 1);
    const pub = secp256k1.recoverPublicKey(recovered, personalHash(message), { prehash: false });
    return normalizeAddress(addressOf(pub));
  } catch {
    return null;
  }
}

export function verifyWalletSignature(message: string, signature: string, address: string): boolean {
  if (!isAddress(address)) return false;
  return recoverAddress(message, signature) === normalizeAddress(address);
}

// Signs with a raw secret key. Tests and tooling use it; browsers use wallets.
export function signLoginMessage(message: string, secretKeyHex: string): string {
  const secret = hexToBytes(secretKeyHex.replace(/^0x/, ""));
  const sig = secp256k1.sign(personalHash(message), secret, { prehash: false, format: "recovered" });
  const out = new Uint8Array(65);
  out.set(sig.slice(1, 65), 0);
  out[64] = sig[0] + 27;
  return "0x" + bytesToHex(out);
}

// Derives the 0x address for a raw secret key. Tests use it.
export function addressOfSecret(secretKeyHex: string): string {
  const secret = hexToBytes(secretKeyHex.replace(/^0x/, ""));
  return normalizeAddress(addressOf(secp256k1.getPublicKey(secret, false)));
}
