# Prompt-to-chip fidelity

Goal: make the compiled chip's combat choices visible and enforceable in the MOBA, while preserving legacy replays. Base: main 291a0eb1670c72120059b3cac9ed49046ef5c6f6.

## Delivered first slice

- Optional rule `target`: `AUTO` (legacy default), `FOE`, `MINION`, `STRUCTURE`, `NONE`. Target classes other than AUTO are strict: no eligible target means no shot. Normal range, visibility, projectile collision and structure vulnerability rules still apply.
- The first matching rule controls movement, target, dash, shield and requested purchase. AUTO retains existing targeting. Existing chips that omit target keep their behavior.
- Muse receives the same targeting contract, rule-order semantics, supported observations, and limitations of DNA, memory and automatic buying. Dashboard exposes rule condition, movement, target, abilities and purchase.
- Malformed model replies with no rules are returned as errors rather than throwing during repair.

## Follow-up work needed before claiming prompt fidelity

1. Collect original player prompt and a structured summary of interpreted priorities, unsupported requests, assumptions and warnings; require player review before installation. Add a migration and privacy/retention policy. Never fabricate support for an intent.
2. Build a scenario suite in Spanish and English with independently specified expected actions, including rule priority, edge cases, valid targets, abilities and economy. Run against the real Muse API as well as stub responses; report semantic accuracy and failures.
3. Give chips explicit control over automatic shopping and fallback without silently changing old policies. Version the simulation and replay contract before changing existing behavior. Address replay determinism and fairness on both sides.
4. Add rule activation and reasons to MOBA replay telemetry. Show which decisions were limited by cooldowns, range, energy or collisions.
5. Update the A/B lab to test MOBA policies on mirrored sides and shared seeds against a diverse benchmark set; report uncertainty. Validate deployed provider and alert when mock is active.
6. Expand the action vocabulary only alongside observable engine capabilities and a test of each instruction through gameplay. Document unsupported tactics rather than silently interpreting them as unrelated rules.
