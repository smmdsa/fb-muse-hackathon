// Economy contracts. The ledger is append-only. Balances never drop below zero.

export type Currency = "AC" | "RP";

export type Txn = {
  seq: number;
  walletId: string;
  idempotencyKey: string;
  currency: Currency;
  delta: number;
  reason: string;
  at: number;
};

export type Wallet = {
  id: string;
  ac: number;
  rp: number;
  owned: string[];
  dayStamps: Record<string, number>;
  keys: Set<string>;
  txns: Txn[];
};

// Hard lock for the hackathon. Real money stays off until legal review.
export const realMoneyPaymentsEnabled = false;

export const AC_WIN = 25;
export const AC_LOSS = 10;
export const AC_DAILY_CAP = 150;
export const DAY_MS = 24 * 60 * 60 * 1000;
