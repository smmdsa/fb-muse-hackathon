// Mock shop. Cosmetics only. Nothing here changes combat.

import { spend } from "./ledger.ts";
import type { Currency, Wallet } from "./types.ts";

export type CatalogItem = {
  id: string;
  name: string;
  currency: Currency;
  price: number;
};

export const CATALOG: CatalogItem[] = [
  { id: "skin-ember", name: "Ember Shell", currency: "AC", price: 100 },
  { id: "skin-tide", name: "Tide Shell", currency: "AC", price: 150 },
  { id: "trail-spark", name: "Spark Trail", currency: "RP", price: 20 },
  { id: "banner-forge", name: "Forge Banner", currency: "RP", price: 30 },
];

export type Receipt = { ok: true; itemId: string } | { ok: false; reason: string };

// The buyer charges once per key and grants the item once.
export function purchase(
  wallet: Wallet,
  input: { key: string; itemId: string; now: number },
): Receipt {
  const item = CATALOG.find((c) => c.id === input.itemId);
  if (!item) return { ok: false, reason: `unknown item ${input.itemId}` };
  if (wallet.owned.includes(item.id)) return { ok: true, itemId: item.id };
  const charged = spend(wallet, {
    key: `shop:${input.key}`,
    currency: item.currency,
    amount: item.price,
    reason: `buy ${item.id}`,
    now: input.now,
  });
  if (!charged.ok) return charged;
  wallet.owned.push(item.id);
  return { ok: true, itemId: item.id };
}
