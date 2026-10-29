// Local HTTP API. Demo bearer tokens only. No external service is touched.

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { openStore, mintId } from "./store.ts";
import type { Store } from "./store.ts";
import { BENCH_POLICY, BOT_PRESETS, buildReplay, fightPolicies } from "@agent-wars/battle-core";
import { analyzeBattle, armoryView, autobattleDigest, autobattleTick, battleConfigFor, board, buyItem, cancelTicket, compileAndPublish, claimFtue, createAgent, createTournament, dashboard, deleteVersion, energyFor, energyView, equipItem, evolutionLab, forceDeleteVersion, ftueStatus, getLeader, getTournament, getVersion, installVersion, listTournaments, matchMode, MAX_PROMPT, openTicket, optInAutobattle, pauseAutobattle, publicProfile, readTicket, registerTournament, renameVersion, reportLeader, requestMatch, retryPortrait, runRanked, runTraining, seasonHistory, spendEnergy, transitionTournament, validateRanked, withMatch } from "./flow.ts";
import { checkLimit, newToken } from "./ids.ts";
import type { TicketMode } from "./flow.ts";

// Per-route sliding windows. Memory-only; a restart clears history.
const authHits = new Map<string, number[]>();
const compileHits = new Map<string, number[]>();
const queueHits = new Map<string, number[]>();
const trainHits = new Map<string, number[]>();
const labHits = new Map<string, number[]>();
const analysisHits = new Map<string, number[]>();

function limited(res: ServerResponse, log: Map<string, number[]>, key: string, windowMs: number, max: number): boolean {
  if (checkLimit(log, key, Date.now(), windowMs, max)) return false;
  send(res, 429, { error: "rate limited, retry later" });
  return true;
}

type Ctx = { store: Store };

function send(res: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type, x-admin-key",
  });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let text = "";
    req.on("data", (chunk: Buffer) => {
      text += chunk.toString();
      if (text.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!text) resolve({});
      else {
        try {
          resolve(JSON.parse(text) as Record<string, unknown>);
        } catch {
          reject(new Error("bad json"));
        }
      }
    });
  });
}

// Admin calls carry a shared secret, never a leader token.
// No key configured means the console stays dark: fail closed.
function adminKey(req: IncomingMessage): string {
  const raw = req.headers["x-admin-key"];
  return typeof raw === "string" ? raw : "";
}

function adminDenied(req: IncomingMessage, res: ServerResponse): boolean {
  const expected = process.env.ADMIN_KEY ?? "";
  if (!expected) {
    send(res, 503, { error: "admin console is disabled: set ADMIN_KEY first" });
    return true;
  }
  const a = Buffer.from(adminKey(req));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    send(res, 401, { error: "admin sign-in required" });
    return true;
  }
  return false;
}

function bearer(req: IncomingMessage, ctx: Ctx): Record<string, unknown> | null {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  return getLeader(ctx.store, token);
}

// The router matches method plus path and answers with JSON.
export function buildRouter(ctx: Ctx): (req: IncomingMessage, res: ServerResponse) => void {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://local");
      const body = await readBody(req).catch(() => null);
      if (body === null) {
        send(res, 400, { error: "bad json: body must parse" });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/auth/session") {
        const handle = typeof body.handle === "string" ? body.handle.trim() : "";
        if (!handle) {
          send(res, 400, { error: "handle is required" });
          return;
        }
        if (limited(res, authHits, handle, 60_000, 10)) return;
        const found = ctx.store.db.prepare("SELECT * FROM leaders WHERE handle = ?").get(handle) as Record<string, unknown> | null;
        if (found) {
          send(res, 200, { token: found.token, leaderId: found.id });
          return;
        }
        const id = mintId("leader");
        const token = newToken("demo");
        ctx.store.db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run(id, handle, token);
        send(res, 200, { token, leaderId: id });
        return;
      }
      if (req.method === "GET" && /^\/v1\/leaders\/[^/]+\/public$/.test(url.pathname)) {
        try {
          send(res, 200, publicProfile(ctx.store, decodeURIComponent(url.pathname.split("/")[3])));
        } catch (err) {
          send(res, 404, { error: (err as Error).message });
        }
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/leaderboard") {
        send(res, 200, { seasonId: "local-s1", rows: board(ctx.store) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/admin/events") {
        if (adminDenied(req, res)) return;
        const id = typeof body.id === "string" ? body.id : "";
        const name = typeof body.name === "string" ? body.name : "";
        const maxPlayers = typeof body.maxPlayers === "number" ? body.maxPlayers : 0;
        const minAp = typeof body.minAp === "number" ? body.minAp : 0;
        const registrationCloseAt = typeof body.registrationCloseAt === "number" ? body.registrationCloseAt : 0;
        try {
          send(res, 201, createTournament(ctx.store, { id, name, maxPlayers, minAp, registrationCloseAt }));
        } catch (err) {
          send(res, 422, { error: (err as Error).message });
        }
        return;
      }
      const adminTransMatch = req.method === "POST" && /^\/v1\/admin\/events\/[^/]+\/transition$/.test(url.pathname);
      if (adminTransMatch) {
        if (adminDenied(req, res)) return;
        const to = typeof body.to === "string" ? body.to : "";
        try {
          send(res, 200, transitionTournament(ctx.store, { eventId: decodeURIComponent(url.pathname.split("/")[4]), to }));
        } catch (err) {
          const msg = (err as Error).message;
          send(res, /unknown tournament/.test(msg) ? 404 : 422, { error: msg });
        }
        return;
      }
      const me = bearer(req, ctx);
      if (!me) {
        send(res, 401, { error: "bearer token is required: call POST /v1/auth/session first" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/me") {
        const auto = autobattleTick(ctx.store, me.id as string);
        const agent = ctx.store.db.prepare("SELECT * FROM agents WHERE leader_id = ?").get(me.id as string);
        const st = energyFor(ctx.store, me.id as string);
        const energy = energyView(st);
        send(res, 200, { leader: me, agent, energy, auto: { optIn: st.optIn, leaseExpiresAt: st.leaseExpiresAt, state: st.state, ran: auto.ran } });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/autobattle/opt-in") {
        try {
          const opt = optInAutobattle(ctx.store, me.id as string);
          const tick = autobattleTick(ctx.store, me.id as string, Date.now(), 3);
          send(res, 200, { ...opt, ran: tick.ran, matches: tick.matches });
        } catch (err) {
          send(res, 404, { error: (err as Error).message });
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/autobattle/pause") {
        send(res, 200, pauseAutobattle(ctx.store, me.id as string));
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/autobattle/digest") {
        send(res, 200, autobattleDigest(ctx.store, me.id as string));
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/agents") {
        const exists = ctx.store.db.prepare("SELECT * FROM agents WHERE leader_id = ?").get(me.id as string);
        if (exists) {
          send(res, 409, { error: "one agent per leader in this phase" });
          return;
        }
        const name = typeof body.name === "string" ? body.name.slice(0, 60) : "";
        const concept = typeof body.concept === "string" ? body.concept.slice(0, 280) : "";
        const bred = await createAgent(ctx.store, process.env, { leaderId: me.id as string, name, concept });
        send(res, 201, { agentId: bred.agentId, portraitUrl: bred.portraitUrl, portraitStatus: bred.portraitStatus, error: bred.error });
        return;
      }
      const retryMatch = req.method === "POST" && /^\/v1\/agents\/[^/]+\/portrait\/retry$/.test(url.pathname);
      if (retryMatch) {
        const agentId = url.pathname.split("/")[3];
        try {
          send(res, 200, await retryPortrait(ctx.store, process.env, { agentId, leaderId: me.id as string }));
        } catch (err) {
          send(res, 404, { error: (err as Error).message });
        }
        return;
      }
      const dashMatch = req.method === "GET" && /^\/v1\/agents\/[^/]+\/dashboard$/.test(url.pathname);
      if (dashMatch) {
        const agentId = url.pathname.split("/")[3];
        try {
          send(res, 200, dashboard(ctx.store, agentId, me.id as string));
        } catch (err) {
          send(res, 404, { error: (err as Error).message });
        }
        return;
      }
      const compileMatch = req.method === "POST" && /^\/v1\/agents\/[^/]+\/policies\/compile$/.test(url.pathname);
      if (compileMatch) {
        if (limited(res, compileHits, me.id as string, 60_000, 6)) return;
        const agentId = url.pathname.split("/")[3];
        const agent = ctx.store.db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as Record<string, unknown> | null;
        if (!agent || agent.leader_id !== me.id) {
          send(res, 404, { error: "agent not found for this leader" });
          return;
        }
        const prompt = typeof body.prompt === "string" ? body.prompt : "";
        if (!prompt) {
          send(res, 400, { error: "prompt is required" });
          return;
        }
        if (prompt.trim().length > MAX_PROMPT) {
          send(res, 400, { error: `prompt must stay under ${MAX_PROMPT} characters` });
          return;
        }
        const out = await compileAndPublish(ctx.store, process.env, { agentId, prompt });
        if (!out.versionId) {
          send(res, 422, { error: "draft failed validation", errors: out.errors, provider: out.provider, isMock: out.isMock, tokens: out.tokens, latencyMs: out.latencyMs });
          return;
        }
        send(res, 201, { versionId: out.versionId, provider: out.provider, isMock: out.isMock, tokens: out.tokens, latencyMs: out.latencyMs });
        return;
      }
      const deleteMatch = req.method === "DELETE" && /^\/v1\/agents\/[^/]+\/policies\/[^/]+$/.exec(url.pathname);
      if (deleteMatch) {
        try {
          send(res, 200, deleteVersion(ctx.store, { leaderId: me.id as string, agentId: url.pathname.split("/")[3], versionId: decodeURIComponent(url.pathname.split("/")[5]) }));
        } catch (err) {
          const msg = (err as Error).message;
          send(res, /not found|unknown version/.test(msg) ? 404 : 422, { error: msg });
        }
        return;
      }
      const renameMatch = req.method === "POST" && /^\/v1\/agents\/[^/]+\/policies\/[^/]+\/rename$/.test(url.pathname);
      if (renameMatch) {
        const label = typeof body.label === "string" ? body.label : "";
        try {
          send(res, 200, renameVersion(ctx.store, {
            leaderId: me.id as string,
            agentId: url.pathname.split("/")[3],
            versionId: decodeURIComponent(url.pathname.split("/")[5]),
            label,
          }));
        } catch (err) {
          send(res, 404, { error: (err as Error).message });
        }
        return;
      }
      const forceMatch = req.method === "POST" && /^\/v1\/agents\/[^/]+\/policies\/[^/]+\/force-delete$/.test(url.pathname);
      if (forceMatch) {
        try {
          send(res, 200, forceDeleteVersion(ctx.store, {
            leaderId: me.id as string,
            agentId: url.pathname.split("/")[3],
            versionId: decodeURIComponent(url.pathname.split("/")[5]),
          }));
        } catch (err) {
          const msg = (err as Error).message;
          send(res, /not found|unknown version/.test(msg) ? 404 : 422, { error: msg });
        }
        return;
      }
      const installMatch = req.method === "POST" && /^\/v1\/agents\/[^/]+\/policies\/install$/.test(url.pathname);
      if (installMatch) {
        const agentId = url.pathname.split("/")[3];
        const versionId = typeof body.versionId === "string" ? body.versionId : "";
        if (!versionId) {
          send(res, 400, { error: "versionId is required" });
          return;
        }
        try {
          send(res, 200, installVersion(ctx.store, { leaderId: me.id as string, agentId, versionId }));
        } catch (err) {
          send(res, 404, { error: (err as Error).message });
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/matches/training") {
        const versionId = typeof body.versionId === "string" ? body.versionId : "";
        const seed = typeof body.seed === "string" && body.seed ? body.seed : `t-${Date.now().toString(36)}`;
        if (!versionId) {
          send(res, 400, { error: "versionId is required" });
          return;
        }
        if (limited(res, trainHits, me.id as string, 60_000, 20)) return;
        const owned = getVersion(ctx.store, versionId);
        if (!owned) {
          send(res, 404, { error: "unknown version" });
          return;
        }
        const owner = ctx.store.db.prepare("SELECT * FROM agents WHERE id = ?").get(owned.agentId) as Record<string, unknown> | null;
        if (!owner || owner.leader_id !== me.id) {
          send(res, 404, { error: "version not found for this leader" });
          return;
        }
        try {
          send(res, 201, runTraining(ctx.store, { versionId, seed }));
        } catch (err) {
          send(res, 404, { error: (err as Error).message });
        }
        return;
      }
      const analysisMatch = req.method === "POST" && /^\/v1\/battles\/[^/]+\/analysis$/.test(url.pathname);
      if (analysisMatch) {
        if (limited(res, analysisHits, me.id as string, 60_000, 10)) return;
        try {
          send(res, 200, await analyzeBattle(ctx.store, process.env, { matchId: decodeURIComponent(url.pathname.split("/")[3]) }));
        } catch (err) {
          send(res, 404, { error: (err as Error).message });
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/lab/ab") {
        if (limited(res, labHits, me.id as string, 60_000, 6)) return;
        const agentId = typeof body.agentId === "string" ? body.agentId : "";
        const promptA = typeof body.promptA === "string" ? body.promptA : "";
        const promptB = typeof body.promptB === "string" ? body.promptB : "";
        const bouts = typeof body.bouts === "number" ? body.bouts : 10;
        if (!agentId || !promptA || !promptB) {
          send(res, 400, { error: "agentId, promptA, and promptB are required" });
          return;
        }
        try {
          send(res, 201, await evolutionLab(ctx.store, process.env, { leaderId: me.id as string, agentId, promptA, promptB, bouts }));
        } catch (err) {
          const msg = (err as Error).message;
          send(res, /not found|required/.test(msg) ? 404 : 422, { error: msg });
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/matches/ranked") {
        const aVersionId = typeof body.aVersionId === "string" ? body.aVersionId : "";
        const bVersionId = typeof body.bVersionId === "string" ? body.bVersionId : "";
        const seed = typeof body.seed === "string" && body.seed ? body.seed : `r-${Date.now().toString(36)}`;
        const key = typeof body.key === "string" && body.key ? body.key : mintId("m");
        if (!aVersionId || !bVersionId) {
          send(res, 400, { error: "aVersionId and bVersionId are required" });
          return;
        }
        const duped = ctx.store.db.prepare("SELECT * FROM matches WHERE id = ?").get(key) as Record<string, unknown> | null;
        if (duped) {
          send(res, 201, { ...duped, deduped: true });
          return;
        }
        try {
          validateRanked(ctx.store, { aVersionId, bVersionId });
        } catch (err) {
          const msg = (err as Error).message;
          send(res, msg.includes("self match") ? 422 : 404, { error: msg });
          return;
        }
        const spent = spendEnergy(ctx.store, me.id as string);
        if (!spent.ok) {
          send(res, 409, { error: spent.reason });
          return;
        }
        try {
          send(res, 201, runRanked(ctx.store, { aVersionId, bVersionId, seed, key }));
        } catch (err) {
          const msg = (err as Error).message;
          const code = msg.includes("duplicate") ? 409 : msg.includes("self match") ? 422 : 404;
          send(res, code, { error: msg });
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/matchmaking/request") {
        const versionId = typeof body.versionId === "string" ? body.versionId : "";
        const mode = typeof body.mode === "string" ? body.mode : "";
        if (!versionId || (mode !== "casual" && mode !== "ranked")) {
          send(res, 400, { error: "versionId and mode casual|ranked are required" });
          return;
        }
        if (limited(res, queueHits, me.id as string, 60_000, 6)) return;
        const resume = openTicket(ctx.store, { leaderId: me.id as string, mode: mode as TicketMode });
        if (resume) {
          send(res, 200, withMatch(ctx.store, resume));
          return;
        }
        try {
          const ticket = requestMatch(ctx.store, { leaderId: me.id as string, versionId, mode: mode as TicketMode });
          send(res, 201, withMatch(ctx.store, ticket));
        } catch (err) {
          send(res, 409, { error: (err as Error).message });
        }
        return;
      }
      const ticketMatch = req.method === "GET" && /^\/v1\/matchmaking\/[^/]+$/.exec(url.pathname);
      if (ticketMatch) {
        const ticketId = url.pathname.split("/")[3];
        try {
          send(res, 200, readTicket(ctx.store, { ticketId, leaderId: me.id as string }));
        } catch (err) {
          send(res, 404, { error: (err as Error).message });
        }
        return;
      }
      const cancelMatch = req.method === "POST" && /^\/v1\/matchmaking\/[^/]+\/cancel$/.test(url.pathname);
      if (cancelMatch) {
        const ticketId = url.pathname.split("/")[3];
        try {
          send(res, 200, cancelTicket(ctx.store, { ticketId, leaderId: me.id as string }));
        } catch (err) {
          send(res, 404, { error: (err as Error).message });
        }
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/tournaments") {
        send(res, 200, { tournaments: listTournaments(ctx.store) });
        return;
      }
      const tournMatch = req.method === "GET" && /^\/v1\/tournaments\/[^/]+$/.exec(url.pathname);
      if (tournMatch) {
        try {
          send(res, 200, getTournament(ctx.store, url.pathname.split("/")[3]));
        } catch (err) {
          send(res, 404, { error: (err as Error).message });
        }
        return;
      }
      const regMatch = req.method === "POST" && /^\/v1\/tournaments\/[^/]+\/register$/.test(url.pathname);
      if (regMatch) {
        const versionId = typeof body.versionId === "string" ? body.versionId : "";
        if (!versionId) {
          send(res, 400, { error: "versionId is required" });
          return;
        }
        try {
          send(res, 201, registerTournament(ctx.store, { eventId: url.pathname.split("/")[3], leaderId: me.id as string, versionId }));
        } catch (err) {
          send(res, 404, { error: (err as Error).message });
        }
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/seasons") {
        send(res, 200, { seasons: seasonHistory(ctx.store) });
        return;
      }
      const repMatch = req.method === "POST" && /^\/v1\/leaders\/[^/]+\/report$/.test(url.pathname);
      if (repMatch) {
        const reason = typeof body.reason === "string" ? body.reason : "";
        try {
          send(res, 200, reportLeader(ctx.store, decodeURIComponent(url.pathname.split("/")[3]), reason));
        } catch (err) {
          send(res, (err as Error).message === "unknown handle" ? 404 : 400, { error: (err as Error).message });
        }
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/armory") {
        send(res, 200, armoryView(ctx.store, me.id as string));
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/armory/buy") {
        const itemId = typeof body.itemId === "string" ? body.itemId : "";
        if (!itemId) {
          send(res, 400, { error: "itemId is required" });
          return;
        }
        try {
          send(res, 200, buyItem(ctx.store, me.id as string, itemId));
        } catch (err) {
          const message = (err as Error).message;
          send(res, message.startsWith("unknown item") ? 404 : 422, { error: message });
        }
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/ftue") {
        send(res, 200, ftueStatus(ctx.store, me.id as string));
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/ftue/claim") {
        const stage = typeof body.stage === "number" ? body.stage : NaN;
        if (!Number.isInteger(stage)) {
          send(res, 400, { error: "stage is required" });
          return;
        }
        try {
          send(res, 200, claimFtue(ctx.store, me.id as string, stage));
        } catch (err) {
          const message = (err as Error).message;
          send(res, message.startsWith("unknown ftue stage") ? 400 : 422, { error: message });
        }
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/armory/equip") {
        const slot = typeof body.slot === "string" ? body.slot : "";
        const itemId = typeof body.itemId === "string" ? body.itemId : "";
        if (!slot || !itemId) {
          send(res, 400, { error: "slot and itemId are required" });
          return;
        }
        try {
          send(res, 200, equipItem(ctx.store, me.id as string, slot, itemId));
        } catch (err) {
          const message = (err as Error).message;
          send(res, message.startsWith("not owned") ? 404 : 422, { error: message });
        }
        return;
      }
      const replayMatch = req.method === "GET" && /^\/v1\/matches\/[^/]+\/replay$/.test(url.pathname);
      if (replayMatch) {
        const id = url.pathname.split("/")[3];
        const match = ctx.store.db.prepare("SELECT * FROM matches WHERE id = ?").get(id) as Record<string, unknown> | null;
        if (!match) {
          send(res, 404, { error: "match not found" });
          return;
        }
        const a = getVersion(ctx.store, match.a_version as string);
        const b = match.b_version === "benchmark-v1" || (match.b_version as string).startsWith("bot:") ? null : getVersion(ctx.store, match.b_version as string);
        let pb = b ? b.policy : BENCH_POLICY;
        if ((match.b_version as string).startsWith("bot:")) {
          const preset = BOT_PRESETS.find((p) => p.id === match.b_version);
          if (!preset) {
            send(res, 410, { error: "replay unavailable: unknown bot" });
            return;
          }
          pb = preset.policy;
        }
        if (!a || (match.b_version !== "benchmark-v1" && !(match.b_version as string).startsWith("bot:") && !b)) {
          send(res, 410, { error: "replay unavailable: a version is gone" });
          return;
        }
        // The row names its sim. MOBA rows re-simulate as MOBA and
        // serve v2 replays. Duel rows keep the v1 path untouched.
        const cfg = battleConfigFor(matchMode(match));
        const again = fightPolicies(a.policy, pb, match.seed as string, cfg);
        const replay = buildReplay(a.policy, pb, match.seed as string, cfg);
        send(res, 200, { stored: match, recomputed: again, replay, identical: again.checksum === match.checksum, startedAt: match.created_at, now: Date.now() });
        return;
      }
      send(res, 404, { error: "unknown route" });
    } catch (err) {
      send(res, 500, { error: `server error: ${(err as Error).message}` });
    }
  };
}

// The starter binds one port. Tests use port 0 and read the real one back.
export function startServer(store: Store, port: number): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer(buildRouter({ store }));
    server.on("error", (err) => reject(err));
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const real = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        port: real,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

