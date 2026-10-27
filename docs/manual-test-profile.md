# Manual test — profile, platform, and queue

Run on the deployed URL. Sign out (clear `aw_token`) between runs.

1. Open `/profile.html`. No token shows the leader card only.
2. Sign in as a fresh handle. Starts at 500 AP, CIRCUIT I.
3. Breed a hero with name plus concept. Portrait is null without the image key.
4. Hero card shows the name, concept, AP, tier plus shield art.
5. Compile a prompt. Response names mock or the live provider.
6. Run a training fight. Result names a winner plus ticks.
7. Dashboard lists the version with chips and trigger counts.
8. Triggers across chips of one fight add up to at most fights times avg ticks.
9. Reload the page. Token persists, hero still shows.
10. Open `/` again. Arena plus Ranks still play and display.

## Queue and energy (needs two handles in two browsers)

11. Sign in on the arena. Energy shows 10/10.
12. Casual quick match with no other human: countdown runs, bot settles it.
13. Result names a `bot:` foe and links the dashboard. Energy drops by one.
14. Second handle queues ranked at once: immediate human pairing, AP moves.
15. Ranked with no humans: ticket stays queued, expires after ten minutes.
16. Drain energy with repeated fights. Queue at zero answers `energy empty`.
