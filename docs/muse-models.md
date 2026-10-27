# Muse models

The game drafts agent logic and agent art with Meta's Muse suite.
The sim never calls a model. Fights settle in code, every time.

## Suite

| Task | Model | Id | Price | Endpoint |
|---|---|---|---|---|
| Prompt to DNA plus rules | Muse Spark 1.3 | `muse-spark-1.3` | $1.25 in, $4.25 out per 1M tokens | `POST {base}/chat/completions` |
| Hard drafts, later | Muse Wonder 1.0 | `muse-wonder-1.0` | $4 in, $20 out per 1M tokens | `POST {base}/chat/completions` |
| Agent portraits, skins | Muse Image 1.0 | `muse-image-1.0` | $0.01 per image | `POST {base}/images/generations` |

Base URL defaults to `https://api.meta.ai/v1` with a Bearer key.
Auth, endpoints, and ids follow the OpenAI-compatible shape.
Confirm the ids in the Meta developer console when you generate the key.

## Why this split

- Compile runs hot. Every publish and every demo calls it. Spark is cheap
  and answers in structured JSON.
- Portraits render once per agent or skin, then cache by URL. Ten cents
  buys ten agents. Never render per fight.
- Wonder waits in the registry for prompts Spark mangles. Switch one env
  var, compare, switch back.
- Ranked, AutoBattle, and tournaments stay deterministic and free.

## Switch models

`packages/ai-provider/src/models.ts` holds the registry. Env wins per task:

- `AGENT_WARS_MODEL_COMPILE` — default `muse-spark-1.3`.
- `AGENT_WARS_MODEL_PORTRAIT` — default `muse-image-1.0`.
- `META_API_BASE` — default `https://api.meta.ai/v1`.
- `META_SPARK_KEY` — compile and drafts. No default. Empty means mock, and results say `isMock: true`.
- `META_IMAGE_KEY` — portraits and skins. No default. Empty means no portraits, and the game runs fine.
- `META_API_KEY` — shared fallback for both when set. Use it only in dev.

`providerFromEnv` picks mock without a key and Meta with one.
`portraitFromEnv` throws without a key. The game runs fine without portraits.

## Secrets

Local: set both keys in the shell before `pnpm --filter @agent-wars/api dev`:

```powershell
$env:META_SPARK_KEY="spark key here"
$env:META_IMAGE_KEY="image key here"
```

Cloudflare: store each key as its own secret, never in `wrangler.toml`.
Split keys keep Spark spend apart from image spend on the dashboard:

```powershell
pnpm dlx wrangler@4 secret put META_SPARK_KEY
pnpm dlx wrangler@4 secret put META_IMAGE_KEY
```

Optional overrides (`META_API_BASE`, `AGENT_WARS_MODEL_COMPILE`,
`AGENT_WARS_MODEL_PORTRAIT`) ride as normal Worker vars or secrets.
Redeploy after each secret change.

## Cost guard

One compile costs a fraction of a cent on Spark. Portraits cost one cent
each and cache. The compile route validates every draft and repairs once,
so a bad reply wastes one call, not a fight.
