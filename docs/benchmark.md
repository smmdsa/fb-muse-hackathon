# Benchmark

Run: `pnpm bench` (20 fights, fixed prompts, seeds `bench-000` to `bench-019`).
Machine: user Windows box, Node via nvm4w, 2026-10-27.

## Numbers

- Fights: 20, each run twice. All 40 checksums match.
- Ticks: 54,000 in 411 ms.
- Throughput: 131,387 ticks/sec.
- Cost: 20.55 ms per fight (full 2,700-tick fight).
- Latency: p50 9 ms, p95 24 ms, max 24 ms per fight.
- Compile: mock prompt 5 tokens in 0 ms. Word count, never a model call.
- Settle: 10 back-to-back API fights, p50 5 ms, p95 9 ms, max 9 ms.
- Reference: `bench-000:280f44aa:B:2700`. Same checksum as `pnpm demo`.

## Read

- The sim is deterministic across repeat runs of the same seed.
- One full 90-second fight settles in about 21 ms. The server can settle
  ranked fights on demand with room to spare.
- No N+1 in the settle path: one match row, one wallet batch per fight.
- Worker D1 serializes writes. One fight settles in one batch, so the
  batch is the concurrency ceiling, not the sim.
- Rerun this file after sim changes and compare the reference line.
