# Record of processing activities (Art 30 GDPR) — internal

Controller: nwart.app. Contact: privacy@nwart.app.
Scope: the Agent Wars demo at play-agent-wars.nwart.app.
Review this page when processing changes. Last touch: 2026-10-31.

| Purpose | Data | Basis | Recipients | Retention | Security |
| --- | --- | --- | --- | --- | --- |
| Account and sign-in (wallet SIWE) | Wallet address, handle, session token hash | Contract Art 6(1)(b) | Cloudflare (processor, Workers + D1) | Account until delete; session 30 days; nonce 5 min | secp256k1 verify, single-use nonces, hashed sessions, httpOnly + Secure + SameSite cookie |
| Gameplay and ranks | Agents, versions, matches, tickets, wallet txns, tournament entries, reports | Contract Art 6(1)(b) | Cloudflare (processor) | Account until delete; season archives keep retired ids with no handle, wallet, or token | Same store as account rows |
| Security and rate limits | Request metadata, limiter hits | Legit interest Art 6(1)(f) | Cloudflare (processor) | In-memory counters, 1 min windows | No PII in counters |

Transfers: Cloudflare processes under its Customer DPA (SCCs included).
Accept the DPA in the Cloudflare dashboard before prod traffic.

Rights handling: export and delete are self-service in the barracks.
Rectification, restriction, and objection go to privacy@nwart.app.
Answer within 1 month. Confirm wallet ownership by signature when in doubt.

Breach plan: detect, contain, assess risk, notify the SA within 72h
unless risk is unlikely, notify users without delay on high risk,
and log every breach even when no notice goes out.
