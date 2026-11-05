# Cloudflare rate limits (manual step)

The worker keeps in-memory throttles, but each isolate holds its own map.
Enforce these rules in the Cloudflare console (Security > WAF > Rate limiting
rules) on `play-agent-wars.nwart.app` so they hold across isolates:

1. `POST /v1/auth/session` — 10 requests per minute per IP, block 10 minutes.
   Demo signup must stay boring even under rotation.
2. `POST /v1/auth/challenge` and `POST /v1/auth/wallet` — 10 per minute per IP,
   block 10 minutes. Wallet login is human-paced.
3. `POST /v1/matchmaking/*` — 30 per minute per IP. Live play never exceeds this.
4. `POST /v1/matches/ranked` — 30 per minute per IP. Same budget as queueing.

Keep the in-code throttles as a second layer; they also guard local dev.
Revisit the numbers if legitimate play ever trips them.
