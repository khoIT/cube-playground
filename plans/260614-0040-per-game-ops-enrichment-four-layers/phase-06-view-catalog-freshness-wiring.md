# Phase 06 — View + Catalog Wiring + Freshness Labels (incremental per-layer)

## Context Links
- Views to extend: `cube-dev/cube/model/views/cfm/user_360.yml`, `cube-dev/cube/model/views/jus/user_360.yml`
- Catalog auto-discovery: `src/pages/Catalog/use-catalog-meta.ts:104` (`fetch /meta?extended=true`)
- Per-game model loader: `cube-dev/cube/cube.js:335-354` (repositoryFactory reads every YAML per game)

## Overview
- **Priority:** P1 — makes the new cubes consumable + correctly labeled.
- **Status:** pending · **Depends on:** Phase 2 (MVP) — then phases 3,4,5 wired in INCREMENTALLY as each lands.
  Do NOT block the monetization wiring on the lagging CS / identity layers.
- **Description:** Extend each game's `user_360.yml` to compose new members PER LAYER as that layer ships
  (monetization first); confirm catalog auto-discovery surfaces them (likely no catalog code change); apply the
  ADVISORY freshness-tier tag + `meta` to every new cube description.

## Key Insights
- Catalog is META-DRIVEN: `use-catalog-meta.ts:104` fetches `/meta?extended=true` and renders whatever cubes the
  active game's model exposes. Once a cube compiles + has `meta`/`description`, it appears in Catalog automatically —
  registration = compile, NOT a code change. VERIFY this (no allowlist gating) before assuming.
- user_360 view references LOGICAL cube names; joins are game-specific. Extending = adding the new cubes' joins + the
  curated dims/measures worth surfacing.
- **Freshness tag is ADVISORY (red-team #5):** put `[freshness: live|lagging|archive]` as the FIRST token of each
  cube `description:` AND a `meta: { freshness: <tier>, source: <iceberg.schema.table> }` block so chat/UI can parse
  it. NOTHING reads it at runtime — it is a label the chat-agent + Catalog surface verbatim. Do NOT describe it as a
  guard/enforcement. A real freshness gate is OPTIONAL + needs user sign-off (out of scope here).
- **View multi-fact fan-out (red-team #9):** composing `user_recharge_daily` + `billing_detail` + `billing_lifetime` +
  cs_ticket_detail into one view can fan out (a whale with N tickets × M payment days × breakdown rows). Specify WHICH
  measures are user_360-safe (user-grain, additive) and add a multi-fact whale query test (phase 8). Surface only
  decision-relevant members, not every member. (`billing_detail` is txn×breakdown grain → expose its dims, keep its
  additive measures queried against the cube, not blended in the view.)

## Requirements
- Functional: cfm + jus user_360 view composes the MVP members first (`user_recharge_daily` (kept), `billing_detail`,
  `billing_lifetime`, user_geo, lifecycle_profile, cs_ticket_detail), then acquisition breakdowns. Every new cube has
  the advisory freshness tag + meta.
- Non-functional: view still compiles + loads under each game's securityContext; no cross-game refs; no multi-fact fan-out
  on the curated measures.

## Architecture
- Data flow: new cubes → user_360 view joins (logical names) → Cube /meta → Catalog auto-render. Freshness tag flows
  description→/meta→Catalog/chat verbatim (label only).
- member-resolver: view uses logical names only; prefix physicalization at request boundary on prod. Nothing to hardcode.

## Related Code Files
- Modify: `cube-dev/cube/model/views/cfm/user_360.yml`, `cube-dev/cube/model/views/jus/user_360.yml`
- Modify: all new cube YAMLs (add advisory freshness tag + `meta` block)
- Read/verify only: `src/pages/Catalog/use-catalog-meta.ts` (confirm no allowlist; add logical names there only if gated)

## Implementation Steps
1. Verify catalog auto-discovery: after phase 2, load `/meta?extended=true` with `x-cube-game: cfm`; confirm the
   monetization cube appears with no code change. If gated by an allowlist, add the logical name there.
2. Extend `views/cfm/user_360.yml` (then jus): add the MONETIZATION join + curated user-grain measures FIRST
   (payer recency/tier, lifetime LTV). Ship. Then add identity (geo-stability/churn-gap), CS (CSAT/VIP), acquisition
   (channel) joins as each layer lands. Keep the spine focused; only user_360-safe (user-grain additive) measures.
3. Apply ADVISORY freshness tag: EVERY new cube description starts `[freshness: ...]` + `meta: { freshness, source }`.
4. Compile both games (isolated check first); load user_360 in Playground; confirm new members queryable, only that
   game's rows return, and no multi-fact fan-out on the curated measures.
5. Spot-check the chat-agent sees the freshness tag in the meta payload (it is a label, not a runtime guard).

## Todo List
- [ ] Verify catalog auto-discovery (no allowlist) OR register logical names
- [ ] Extend cfm/jus user_360.yml — MONETIZATION first (incremental), then identity/CS/acquisition
- [ ] Advisory freshness tag + meta on every new cube
- [ ] Multi-fact fan-out avoided (user_360-safe measures only)
- [ ] Compile (isolated) + Playground load both games
- [ ] Chat-agent freshness-tag spot check (label only)

## Success Criteria
- New members browsable in Catalog + queryable via user_360 in Playground, per game, layer-by-layer.
- Every new cube carries a parseable ADVISORY freshness tier in description + meta (no enforcement claim).
- No cross-game leak; logical names only in YAML; no multi-fact fan-out on curated measures.

## Risk Assessment
- **Catalog gated by allowlist (assumption wrong)** (Low×Med): new cubes invisible. Mitigate: step 1 verifies first.
- **Multi-fact view fan-out** (Med×High): whale rows multiply across fact joins. Mitigate: user_360-safe measure list + phase-8 whale test.
- **Freshness tag mistaken for a guard** (Med×Med): downstream assumes enforcement. Mitigate: label only; documented advisory.

## Security Considerations
- View inherits cube `public: false` on PII dims — verify no PII dim (IP/device/phone/email/staff-id) leaks into user_360.
