// Full user path over real HTTP: auth, breed, compile, install, queue,
// settle, replay, portrait retry, autobattle opt-in and digest,
// tournament list. Run with: pnpm e2e:path (starts a local server).
// Every step asserts. Any failure exits non-zero with the step name.

import { openStore, startServer } from "../apps/api/src/index.ts";

const store = openStore(":memory:");
const { port, close } = await startServer(store, 0);
const BASE = `http://127.0.0.1:${port}`;

const fail = async (step, msg) => {
  console.error(`e2e path failed at ${step}: ${msg}`);
  await close().catch(() => {});
  process.exit(1);
};

const step = async (name, method, path, body, token) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, name };
};

const need = async (r, status, extra) => {
  if (r.status !== status) await fail(r.name, `want ${status}, got ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
  if (extra) extra(r.data);
};

const s = await step("session", "POST", "/v1/auth/session", { handle: "e2e" });
await need(s, 200);
const token = s.data.token;

const a = await step("breed", "POST", "/v1/agents", { name: "E2E", concept: "patient holder" }, token);
await need(a, 201, (d) => { if (d.portraitStatus !== "faceless") fail("breed", "want faceless"); });
const agentId = a.data.agentId;

const v = await step("compile", "POST", `/v1/agents/${agentId}/policies/compile`, { prompt: "hold the center patiently" }, token);
await need(v, 201, (d) => { if (!d.tokens || d.tokens <= 0) fail("compile", "want token audit"); });
const versionId = v.data.versionId;

const i = await step("install", "POST", `/v1/agents/${agentId}/policies/install`, { versionId }, token);
await need(i, 200);

const q = await step("queue", "POST", "/v1/matchmaking/request", { versionId, mode: "casual" }, token);
await need(q, 201);

let ticket = q.data;
for (let n = 0; n < 12 && ticket.status === "queued"; n += 1) {
  await new Promise((r) => setTimeout(r, 3000));
  const t = await step("poll", "GET", `/v1/matchmaking/${ticket.id}`, null, token);
  await need(t, 200);
  ticket = t.data;
}
if (ticket.status !== "settled" || !ticket.match) fail("settle", `ticket never settled: ${ticket.status}`);
const match = ticket.match;

const r = await step("replay", "GET", `/v1/matches/${match.id}/replay`, null, token);
await need(r, 200, (d) => {
  if (d.identical !== true) fail("replay", "server checksum differs");
  if (!d.replay || !d.replay.frames || !d.replay.frames.length) fail("replay", "no frames");
  if (d.replay.checksum !== match.checksum) fail("replay", "checksum drift");
});

const retry = await step("portrait-retry", "POST", `/v1/agents/${agentId}/portrait/retry`, {}, token);
await need(retry, 200, (d) => { if (d.portraitStatus !== "faceless") fail("portrait-retry", "want faceless"); });

const opt = await step("autobattle-opt-in", "POST", "/v1/autobattle/opt-in", {}, token);
await need(opt, 200, (d) => { if (!d.leaseExpiresAt) fail("autobattle-opt-in", "no lease"); });

const digest = await step("digest", "GET", "/v1/autobattle/digest", null, token);
await need(digest, 200, (d) => { if (d.optIn !== true) fail("digest", "want opt-in"); });

const pause = await step("autobattle-pause", "POST", "/v1/autobattle/pause", {}, token);
await need(pause, 200);

const reg = await step("cup-register", "POST", "/v1/tournaments/s1-kickoff/register", { versionId }, token);
await need(reg, 201, (d) => { if (d.entered !== true) fail("cup-register", "not entered"); });

const dash = await step("dashboard", "GET", `/v1/agents/${agentId}/dashboard`, null, token);
await need(dash, 200, (d) => {
  if (!Array.isArray(d.history) || !d.history.length) fail("dashboard", "no history");
  if (!Array.isArray(d.versions) || !d.versions[0].dna) fail("dashboard", "no dna");
});

console.log(`e2e path green: breed, draft, install, queue, settle (${match.winner} in ${match.ticks}), replay verified, autobattle, cup seat.`);
await close();
