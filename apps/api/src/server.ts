// Local HTTP API. Demo bearer tokens only. No external service is touched.

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { openStore, mintId } from "./store.ts";
import type { Store } from "./store.ts";
import { BENCH_POLICY, fightPolicies } from "@agent-wars/battle-core";
import { board, compileAndPublish, getLeader, getVersion, runRanked, runTraining } from "./flow.ts";

type Ctx = { store: Store };

function send(res: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
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
        const found = ctx.store.db.prepare("SELECT * FROM leaders WHERE handle = ?").get(handle) as Record<string, unknown> | null;
        if (found) {
          send(res, 200, { token: found.token, leaderId: found.id });
          return;
        }
        const id = mintId("leader");
        const token = `demo_${id}_${Math.random().toString(36).slice(2)}`;
        ctx.store.db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run(id, handle, token);
        send(res, 200, { token, leaderId: id });
        return;
      }
      const me = bearer(req, ctx);
      if (!me) {
        send(res, 401, { error: "bearer token is required: call POST /v1/auth/session first" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/me") {
        const agent = ctx.store.db.prepare("SELECT * FROM agents WHERE leader_id = ?").get(me.id as string);
        send(res, 200, { leader: me, agent });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/agents") {
        const exists = ctx.store.db.prepare("SELECT * FROM agents WHERE leader_id = ?").get(me.id as string);
        if (exists) {
          send(res, 409, { error: "one agent per leader in this phase" });
          return;
        }
        const id = mintId("agent");
        ctx.store.db.prepare("INSERT INTO agents (id, leader_id, active_version_id) VALUES (?, ?, NULL)").run(id, me.id as string);
        send(res, 201, { agentId: id });
        return;
      }
      const compileMatch = req.method === "POST" && /^\/v1\/agents\/[^/]+\/policies\/compile$/.test(url.pathname);
      if (compileMatch) {
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
        const out = await compileAndPublish(ctx.store, { agentId, prompt });
        if (!out.versionId) {
          send(res, 422, { error: "draft failed validation", errors: out.errors });
          return;
        }
        send(res, 201, { versionId: out.versionId });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/matches/training") {
        const versionId = typeof body.versionId === "string" ? body.versionId : "";
        const seed = typeof body.seed === "string" && body.seed ? body.seed : `t-${Date.now().toString(36)}`;
        if (!versionId) {
          send(res, 400, { error: "versionId is required" });
          return;
        }
        try {
          send(res, 201, runTraining(ctx.store, { versionId, seed }));
        } catch (err) {
          send(res, 404, { error: (err as Error).message });
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
        try {
          send(res, 201, runRanked(ctx.store, { aVersionId, bVersionId, seed, key }));
        } catch (err) {
          const msg = (err as Error).message;
          const code = msg.includes("duplicate") ? 409 : msg.includes("self match") ? 422 : 404;
          send(res, code, { error: msg });
        }
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/leaderboard") {
        send(res, 200, { seasonId: "local-s1", rows: board(ctx.store) });
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
        const b = match.b_version === "benchmark-v1" ? null : getVersion(ctx.store, match.b_version as string);
        if (!a || (match.b_version !== "benchmark-v1" && !b)) {
          send(res, 410, { error: "replay unavailable: a version is gone" });
          return;
        }
        const again = fightPolicies(a.policy, b ? b.policy : BENCH_POLICY, match.seed as string);
        send(res, 200, { stored: match, recomputed: again, identical: again.checksum === match.checksum });
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

