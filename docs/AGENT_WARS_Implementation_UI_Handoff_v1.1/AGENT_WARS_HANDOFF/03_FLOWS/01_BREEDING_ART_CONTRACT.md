# Breeding and image-generation handoff
## Concept distinction
BREED = creation of persistent character identity + canonical look. User enters **birth prompt**, NOT combat AI logic. CHIPS = tactical behavior. Breeding never changes HP/damage/movement, and a cosmetic change never alters matchmaking.

## Canonical visual rules (must be included server-side in every image generation)
- Universe: AGENT WARS professional industrial sci-fi esports league, distinctive manufactured combat robot, believable engineered mechanical joints/armor, crisp layered shapes, iconic readable silhouette.
- Composition: exactly ONE full-body robot, front three-quarter view facing camera-left ~25°; neutral ready stance; head, arms, legs and feet fully visible; centered; feet on same baseline; subject uses ~78% canvas height; no cropping.
- Camera: 50mm-equivalent orthographic/isometric-lite character showcase, eye level to slightly above, consistent across agents; no action poses or extreme foreshortening.
- Frame: square 1024x1024 master, sRGB RGBA when supported, clean flat deep-navy background (#101923) or transparent for final cutout, soft grounded shadow only. Poster/card may compose around output separately. DO NOT embed typography, emblems, watermarks, UI panels, game stats, multiple characters, photoreal humans, guns pointing at viewer or trademarks.
- Material language: matte ceramic/painted alloy plates, graphite joints, modest emissive technology accents, precise panel line highlights, 2–4 dominant colors max, high silhouette readability at 96px, no overly detailed noisy greebles.
- Rendering: premium stylized 3D game character concept rendered with crisp 2D readability, clean edges, restrained bloom, controlled key/fill lighting, coherent lighting from upper-left, studio quality.
- Skeleton consistency: same approximate head-to-body ratio (~1:5), two arms, two legs, stable port/chip docking location on upper chest; cosmetic forms may differ but must remain visibly same league/product line.

## User-controlled variation (whitelisted + interpreted)
Birth prompt max 280 characters affects: identity/personality metaphor, armor motif, palette/accent, silhouette emphasis (agile / bulky / technical), decorative markings, optional small non-combat attachments. e.g. 'A nimble fox-inspired reconnaissance bot with white ceramic armor, amber optical sensors and sleek shoulder fins.' The user prompt NEVER overrides fixed orientation, composition, number of characters, logo restriction, safety rules or competitive balance.

## Prompt template (server assembled)
```
SYSTEM ART BIBLE: [all canonical visual rules above]
CHARACTER ID: {safeName}
BIRTH CONCEPT: {moderatedUserConcept}
COSMETIC PARAMETERS: chassis={chassis}, accentColor={accentColor}, temperament={temperament}, seed={stableSeed}
REQUIRE: single whole robot / front three-quarter camera-left / same scale / centered / matching standard rig and chest chip slot / no text / no watermark / square 1024.
```
Negative prompt if supported: `side/back view, cropped legs, human, extra limbs, weapons firing, background scenery, text, branding, painterly blur, overexposed glow, busy silhouette, split panels`.

## Output contract
`birthId`, `agentId`, `promptVersion`, `styleBibleVersion`, `userConcept`, `normalizedCosmeticParams`, `seed`, `modelId`, `provider`, `isMock`, `generationStatus` (`PENDING|PROCESSING|SUCCEEDED|FAILED|FALLBACK`), `portraitUrl`, `assetSha256`, `createdAt`. Cache files in R2 or equivalent and serve from controlled URL, not ephemeral provider image links. Preserve original prompt provenance and moderation logs. A retry creates new cosmetic revision without creating a second competitive agent. No duplicate jobs on repeated POST/idempotency key.

## Fallback
If Meta Image is absent/unavailable: show deterministic in-house robot silhouette based on seed + palette, tell user 'Placeholder art — image generation unavailable', preserve identity and continue to CHIP flow. Don't block game on art provider failure.

## Acceptance tests
- 10 distinct birth concepts produce images with consistent framing, head/feet visible, same lighting background, readable at 96px, recognizably distinct, no text.
- Same `agentId` has stable canonical portrait URL after refresh and across sessions.
- Malformed/policy-breaking prompts are rejected or safely normalized without changing hard rules.
- No tactical power change from image or birth prompt.
- Image unavailable → fallback without preventing creation; retry allowed with clear state.
