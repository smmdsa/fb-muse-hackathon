// E2E origin server. One port serves the game files and the API.
// Tests start it in-process, so no extra terminal is needed.

import { createServer } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { openStore, buildRouter } from "../apps/api/src/index.ts";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const GAME_DIR = fileURLToPath(new URL("../game/agent-wars/", import.meta.url));

// The starter opens a fresh temp database and a random free port.
export async function startE2EServer() {
  const dbPath = join(tmpdir(), `agent-wars-e2e-${process.pid}-${Date.now()}.db`);
  const store = openStore(dbPath);
  const api = buildRouter({ store });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname.startsWith("/v1/")) {
      api(req, res);
      return;
    }
    let name = decodeURIComponent(url.pathname);
    if (name === "/") name = "/arena.html";
    const safe = normalize(name).split(sep).filter((p) => p && p !== "." && p !== "..").join(sep);
    const file = join(GAME_DIR, safe);
    if (!file.startsWith(GAME_DIR)) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("denied");
      return;
    }
    readFile(file).then(
      (body) => {
        res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream" });
        res.end(body);
      },
      () => {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("missing");
      },
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`,
    store,
    close: async () => {
      await new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      });
      store.close();
      await rm(dbPath, { force: true });
    },
  };
}
