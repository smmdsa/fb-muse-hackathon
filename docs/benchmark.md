# Benchmark

Run: `pnpm bench` (20 fights, fixed prompts, seeds `bench-000` to `bench-019`).
Machine: user Windows box, Node via nvm4w, 2026-10-27.

## Numbers

- Fights: 20, each run twice. All 40 checksums match.
- Ticks: 54,000 in 321 ms.
- Throughput: 168,224 ticks/sec.
- Cost: 16.05 ms per fight (full 2,700-tick fight).
- Reference: `bench-000:280f44aa:B:2700`. Same checksum as `pnpm demo`.

## Read

- The sim is deterministic across repeat runs of the same seed.
- One full 90-second fight settles in about 16 ms. The server can settle
  ranked fights on demand with room to spare.
- Rerun this file after sim changes and compare the reference line.
