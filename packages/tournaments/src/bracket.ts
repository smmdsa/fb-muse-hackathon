// Single-elim bracket. The seed draws the bracket. The final runs best-of-3.

import type { Bracket, Championship, MatchSlot } from "./types.ts";

// The draw uses a small local generator. No outside entropy enters.
function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The seeder shuffles entries and builds rounds. It needs a full house.
export function seedBracket(event: Championship): Championship {
  if (event.phase !== "LOCKED") {
    throw new Error(`seed denied in phase ${event.phase}`);
  }
  const n = event.entries.length;
  if (n < 2 || (n & (n - 1)) !== 0) {
    throw new Error(`seed needs a power-of-two house, got ${n}`);
  }
  const rand = mulberry(hashSeed(event.seed + ":" + event.id));
  const order = [...event.entries];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const rounds = Math.log2(n);
  const slots: MatchSlot[] = [];
  let game = 1;
  let prev: MatchSlot[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const count = n / Math.pow(2, round);
    const cur: MatchSlot[] = [];
    for (let s = 0; s < count; s += 1) {
      const bestOf = round === rounds ? 3 : 1;
      const slot: MatchSlot = {
        id: `r${round}-m${game++}`,
        round,
        slotA: null,
        slotB: null,
        bestOf,
        winsA: 0,
        winsB: 0,
        winnerId: null,
        loserTo: null,
      };
      if (round === 1) {
        slot.slotA = order[s * 2].lockedVersionId;
        slot.slotB = order[s * 2 + 1].lockedVersionId;
      } else {
        slot.loserTo = null;
        prev[s * 2].loserTo = slot.id;
        prev[s * 2 + 1].loserTo = slot.id;
      }
      cur.push(slot);
    }
    slots.push(...cur);
    prev = cur;
  }
  const bracket: Bracket = { rounds, slots, championId: null };
  return { ...event, bracket, phase: "SEEDED" };
}

// The reporter records one game. Winners advance on slot links.
export function reportGame(
  event: Championship,
  input: { slotId: string; winnerVersionId: string },
): Championship {
  if (!event.bracket) throw new Error("no bracket to report on");
  if (event.phase !== "SEEDED" && event.phase !== "LIVE") {
    throw new Error(`report denied in phase ${event.phase}`);
  }
  const slots = event.bracket.slots.map((s) => ({ ...s }));
  const slot = slots.find((s) => s.id === input.slotId);
  if (!slot) throw new Error(`unknown slot ${input.slotId}`);
  if (slot.winnerId) throw new Error(`slot ${input.slotId} already decided`);
  if (input.winnerVersionId !== slot.slotA && input.winnerVersionId !== slot.slotB) {
    throw new Error("winner is not in this slot");
  }
  if (input.winnerVersionId === slot.slotA) slot.winsA += 1;
  else slot.winsB += 1;
  const need = Math.ceil(slot.bestOf / 2);
  let championId: string | null = null;
  if (slot.winsA >= need || slot.winsB >= need) {
    slot.winnerId = input.winnerVersionId;
    const next = slots.find((s) => s.id === slot.loserTo);
    if (next) {
      if (next.slotA === null) next.slotA = slot.winnerId;
      else if (next.slotB === null) next.slotB = slot.winnerId;
    } else {
      championId = slot.winnerId;
    }
  }
  const done = slots.every((s) => s.winnerId !== null);
  return {
    ...event,
    bracket: { rounds: event.bracket.rounds, slots, championId },
    phase: done ? "COMPLETED" : "LIVE",
  };
}
