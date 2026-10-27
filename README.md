# Agent Wars

A human Leader designs one combat robot. Robots fight 1v1 in a deterministic arena.

## Status

S1 is active. The sim runs and the demo viewer plays. See [implementation status](docs/implementation-status.md) for what works and what is planned.

## Layout

- `packages/battle-core/` holds the deterministic sim and its tests.
- `game/agent-wars/` holds the S1 browser demo (`index.html`, `style.css`, `game.js`).
- `work/` holds the board. The tree is the truth.
- `docs/` holds the GDD and the status file.

## Commands

If a command fails, read the error and fix the cause before you retry.

- Install: `pnpm install`. Scripts never run at install (`.npmrc` pins `ignore-scripts=true`).
- Run all tests: `pnpm test`
- Run pnpm from a plain path. If a run fails with `lstat 'E:'`, run `Set-Location -Path 'E:\muse-hacktoon'` first.

## API

Start it: `pnpm --filter @agent-wars/api dev`. It serves `http://127.0.0.1:8787` with a file database in `data/`.

Live at https://agent-wars-api.smmdsa.workers.dev (health, leaderboard, and replay reads run on D1).

Deploy it to Cloudflare (needs your account and one D1 id):

- `wrangler d1 create agent-wars` gives the database id. Set it in `wrangler.toml`.
- `wrangler d1 migrations apply DB --local` applies `migrations/0001_schema.sql`.
- `wrangler dev` serves the worker locally. Health, leaderboard, and replay reads run on D1.
- `wrangler deploy` ships it. Write routes still run on the Node API until the store ports to async D1.

Prove the local API by hand (needs a shell that can bind ports):

- `curl -X POST http://127.0.0.1:8787/v1/auth/session -d '{"handle":"you"}'` returns a token.
- `curl -X POST http://127.0.0.1:8787/v1/agents -H "Authorization: Bearer TOKEN"` creates one agent.
- `curl -X POST http://127.0.0.1:8787/v1/agents/AGENT/policies/compile -H "Authorization: Bearer TOKEN" -d '{"prompt":"rush them down"}'` publishes a version.
- `curl -X POST http://127.0.0.1:8787/v1/matches/training -H "Authorization: Bearer TOKEN" -d '{"versionId":"VERSION","seed":"t1"}'` returns a checksum.
- Run sim tests only: from `packages/battle-core`, run `node --test ./test/determinism.test.mjs ./test/mirror.test.mjs`
- Smoke the sim: from `packages/battle-core`, run `node ./scripts/build-check.mjs`
- Serve the demo: from `game/agent-wars`, run `python3 -m http.server 8765`, then open `http://127.0.0.1:8765/` in a browser.
- Node on this drive needs a plain path. If a test fails with `lstat 'E:'`, run `Set-Location -Path 'E:\muse-hacktoon\packages\battle-core'` first.

## Rules

- The sim owns all outcomes. The viewer never changes a result.
- One Leader owns one agent in this phase.
- Cosmetics never buy power.
