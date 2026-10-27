// Registration gate. Cutoff, eligibility, and dupes each fail loudly.

import type { Championship, Entry, EventPhase } from "./types.ts";

// The organizer chain. Every step needs the one before it. Terminal phases end the line.
const NEXT: Record<EventPhase, EventPhase[]> = {
  DRAFT: ["ANNOUNCED", "CANCELLED"],
  ANNOUNCED: ["REGISTRATION_OPEN", "CANCELLED"],
  REGISTRATION_OPEN: ["LOCKED", "CANCELLED"],
  LOCKED: ["LIVE"],
  SEEDED: ["LIVE"],
  LIVE: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

// The transition moves one legal step. Jumps and dead ends throw.
export function transition(event: Championship, to: EventPhase): Championship {
  if (!(NEXT[event.phase] as EventPhase[]).includes(to)) {
    throw new Error(`transition ${event.phase} to ${to} denied`);
  }
  return { ...event, phase: to };
}

export type Reject = { ok: false; reason: string };
export type Accept = { ok: true; entry: Entry };
export type Outcome = Accept | Reject;

// The factory builds an announced event with a fixed player cap.
export function createEvent(input: {
  id: string;
  seed: string;
  maxPlayers: number;
  minAp: number;
  registrationCloseAt: number;
}): Championship {
  return {
    ...input,
    phase: "REGISTRATION_OPEN",
    entries: [],
    bracket: null,
  };
}

// The gate takes one registration. Late, weak, or repeated entries fail.
export function register(
  event: Championship,
  input: { leaderId: string; agentVersionId: string; ap: number; now: number },
): Outcome {
  if (event.phase !== "REGISTRATION_OPEN") {
    return { ok: false, reason: `registration closed in phase ${event.phase}` };
  }
  if (input.now > event.registrationCloseAt) {
    return { ok: false, reason: "registration past cutoff" };
  }
  if (input.ap < event.minAp) {
    return { ok: false, reason: `AP ${input.ap} below minimum ${event.minAp}` };
  }
  if (event.entries.some((e) => e.leaderId === input.leaderId)) {
    return { ok: false, reason: `leader ${input.leaderId} already registered` };
  }
  if (event.entries.length >= event.maxPlayers) {
    return { ok: false, reason: "event is full" };
  }
  if (!input.agentVersionId) {
    return { ok: false, reason: "agent version id is required" };
  }
  return {
    ok: true,
    entry: {
      leaderId: input.leaderId,
      agentVersionId: input.agentVersionId,
      lockedVersionId: null,
      registeredAt: input.now,
    },
  };
}

// The adder stores an accepted entry. It refuses anything unaccepted.
export function addEntry(event: Championship, outcome: Outcome): Championship {
  if (!outcome.ok) return event;
  return { ...event, entries: [...event.entries, outcome.entry] };
}

// The lock freezes versions. Post-lock edits never enter the event.
export function lock(event: Championship): Championship {
  const entries = event.entries.map((e) => ({ ...e, lockedVersionId: e.agentVersionId }));
  return { ...event, entries, phase: "LOCKED" };
}
