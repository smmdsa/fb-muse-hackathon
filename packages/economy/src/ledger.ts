// Wallet ledger. One key posts once. Caps hold per rolling day.

import {
  AC_DAILY_CAP,
  AC_LOSS,
  AC_WIN,
  DAY_MS,
  realMoneyPaymentsEnabled,
} from "./types.ts";
import type { Currency, Txn, Wallet } from "./types.ts";

export type EarnResult = { credited: number; capped: boolean; keyUsed: boolean };

// The factory seeds a wallet. Test wallets start with mock RP.
export function createWallet(id: string, seedRp = 0): Wallet {
  return { id, ac: 0, rp: seedRp, owned: [], dayStamps: {}, keys: new Set(), txns: [] };
}

// The earner credits an AC result. No-contest and suspicious results pay zero.
export function earnAc(
  wallet: Wallet,
  input: { key: string; kind: "win" | "loss" | "no-contest"; suspicious: boolean; now: number },
): EarnResult {
  if (wallet.keys.has(input.key)) {
    return { credited: 0, capped: false, keyUsed: true };
  }
  wallet.keys.add(input.key);
  if (input.kind === "no-contest" || input.suspicious) {
    post(wallet, input.key, "AC", 0, `no-pay ${input.kind}`, input.now);
    return { credited: 0, capped: false, keyUsed: false };
  }
  const want = input.kind === "win" ? AC_WIN : AC_LOSS;
  const day = dayMark(input.now);
  const used = wallet.dayStamps[day] ?? 0;
  const room = Math.max(0, AC_DAILY_CAP - used);
  const credited = Math.min(want, room);
  wallet.dayStamps[day] = used + credited;
  post(wallet, input.key, "AC", credited, `match ${input.kind}`, input.now);
  return { credited, capped: credited < want, keyUsed: false };
}

// The spender moves funds out. Poor wallets fail without a posting.
export function spend(
  wallet: Wallet,
  input: { key: string; currency: Currency; amount: number; reason: string; now: number },
): { ok: true } | { ok: false; reason: string } {
  if (wallet.keys.has(input.key)) return { ok: true };
  const balance = input.currency === "AC" ? wallet.ac : wallet.rp;
  if (balance < input.amount) {
    return { ok: false, reason: `insufficient ${input.currency}` };
  }
  wallet.keys.add(input.key);
  post(wallet, input.key, input.currency, -input.amount, input.reason, input.now);
  return { ok: true };
}

// Real money stays locked. This function always throws.
export function purchaseWithRealMoney(): never {
  void realMoneyPaymentsEnabled;
  throw new Error("real-money payments are disabled pending legal review");
}

// The poster appends one txn and moves the balance. Balances never go negative.
function post(
  wallet: Wallet,
  key: string,
  currency: Currency,
  delta: number,
  reason: string,
  now: number,
): Txn {
  const txn: Txn = {
    seq: wallet.txns.length,
    walletId: wallet.id,
    idempotencyKey: key,
    currency,
    delta,
    reason,
    at: now,
  };
  wallet.txns.push(txn);
  if (currency === "AC") wallet.ac = Math.max(0, wallet.ac + delta);
  else wallet.rp = Math.max(0, wallet.rp + delta);
  return txn;
}

function dayMark(now: number): string {
  return String(Math.floor(now / DAY_MS));
}
