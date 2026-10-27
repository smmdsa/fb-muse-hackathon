// Swiss pairing engine. Score groups first, rematches never when avoidable.
// Deterministic per seed: the same room and seed always draw the same round.

import type { Entrant, RoundPairing, RoundResult } from "./types.ts";

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

// The bye goes to the lowest score with the fewest byes. Ties break by id.
function pickBye(entrants: Entrant[]): Entrant | null {
  if (entrants.length % 2 === 0) return null;
  const ordered = [...entrants].sort((x, y) => x.byes - y.byes || x.score - y.score || (x.id < y.id ? -1 : 1));
  return ordered[0];
}

// The pairing walks score order. Each player takes the strongest rival
// they never faced. Ties shuffle within the score group, so the seed
// draws real variety. A forced repeat counts, never hides.
export function pairRound(entrants: Entrant[], seed: string): RoundPairing {
  const rand = mulberry(hashSeed(seed));
  const bye = pickBye(entrants);
  const pool = entrants.filter((e) => e.id !== bye?.id);
  pool.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  const ordered: Entrant[] = [];
  let head = 0;
  while (head < pool.length) {
    let tail = head;
    while (tail < pool.length && pool[tail].score === pool[head].score) tail += 1;
    const group = pool.slice(head, tail);
    for (let i = group.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [group[i], group[j]] = [group[j], group[i]];
    }
    ordered.push(...group);
    head = tail;
  }
  const pairs: [string, string][] = [];
  let repeats = 0;
  const waiting = ordered;
  while (waiting.length >= 2) {
    const first = waiting.shift() as Entrant;
    const faced = new Set(first.opponents);
    const idx = waiting.findIndex((e) => !faced.has(e.id));
    if (idx === -1) {
      const foe = waiting.shift() as Entrant;
      pairs.push([first.id, foe.id]);
      repeats += 1;
    } else {
      const [foe] = waiting.splice(idx, 1);
      pairs.push([first.id, foe.id]);
    }
  }
  return { pairs, bye: bye ? bye.id : null, repeats };
}

// Buchholz sums the final scores of beaten paths, not the hype.
export function buchholz(entrants: Entrant[], id: string): number {
  const table = new Map(entrants.map((e) => [e.id, e.score]));
  const me = entrants.find((e) => e.id === id);
  if (!me) return 0;
  return me.opponents.reduce((sum, opp) => sum + (table.get(opp) ?? 0), 0);
}

// Standings break score ties by Buchholz, then by id. The order is total.
export function standings(entrants: Entrant[]): Entrant[] {
  return [...entrants].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const tie = buchholz(entrants, b.id) - buchholz(entrants, a.id);
    if (tie !== 0) return tie;
    return a.id < b.id ? -1 : 1;
  });
}

// Results return a fresh room. Wins score one, draws split half.
export function applyResults(entrants: Entrant[], results: RoundResult[], byeId: string | null): Entrant[] {
  const gains = new Map<string, number>();
  const foes = new Map<string, string[]>();
  const add = (id: string, gain: number, foe: string | null): void => {
    gains.set(id, (gains.get(id) ?? 0) + gain);
    if (foe) foes.set(id, [...(foes.get(id) ?? []), foe]);
  };
  for (const r of results) {
    if (r.winner === "a") {
      add(r.a, 1, r.b);
      add(r.b, 0, r.a);
    } else if (r.winner === "b") {
      add(r.a, 0, r.b);
      add(r.b, 1, r.a);
    } else {
      add(r.a, 0.5, r.b);
      add(r.b, 0.5, r.a);
    }
  }
  if (byeId) add(byeId, 1, null);
  return entrants.map((e) => ({
    ...e,
    score: e.score + (gains.get(e.id) ?? 0),
    opponents: [...e.opponents, ...(foes.get(e.id) ?? [])],
    byes: e.byes + (e.id === byeId ? 1 : 0),
  }));
}
