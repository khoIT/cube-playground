# Phase 06 — View + Catalog Wiring + Freshness Labels

## Context Links
- Views to extend: `cube-dev/cube/model/views/cfm/user_360.yml` (914 lines), `cube-dev/cube/model/views/jus/user_360.yml` (301 lines)
- Catalog auto-discovery: `src/pages/Catalog/use-catalog-meta.ts:104` (`fetch /meta?extended=true`) + `:56` mergeCdpMapping
- Per-game-filter report §4 (views respect game scope via repositoryFactory)

## Overview
- **Priority:** P1 — makes the new cubes consumable + correctly labeled.
- **Status:** pending · **Depends on:** Phases 2,3,4,5.
- **Description:** Extend each game's `user_360.yml` to compose the new monetization/identity/CS/acquisition
  members; confirm catalog auto-discovery surfaces them (no catalog code change expected); apply the
  freshness-tier tag + `meta` to EVERY new cube description so chat-agent + Catalog show it.

## Key Insights
- Catalog is META-DRIVEN: `use-catalog-meta.ts:104` fetches `/meta?extended=true` and renders whatever cubes
  the active game's model exposes. So once new cubes compile, they appear in Catalog automatically — registration
  = compile + add `meta`/`description`, NOT a code change. VERIFY this holds (no allowlist gating).
- user_360 view references LOGICAL cube names and joins are game-specific (per-game-filter report §4). Extending
  it = adding the new cubes' joins + the dims/measures worth surfacing in the 360 spine.
- Freshness tier must be machine-readable: put `[freshness: live|lagging|archive]` as the FIRST token of each
  cube `description:` AND optionally a `meta: { freshness: live }` block so UI/chat can parse without string-matching.

## Requirements
- Functional: cfm + jus user_360 view composes payer_daily, payment_history, user_geo, lifecycle_profile,
  behavior_profile, cs_ticket_detail, (acquisition breakdowns). Every new cube has freshness tag + meta.
- Non-functional: view still compiles + loads under each game's securityContext; no cross-game refs.

## Architecture
- Data flow: new cubes (phases 2–5) → user_360 view joins (logical names) → Cube /meta → Catalog auto-render.
  Freshness tag flows description→/meta→Catalog/chat verbatim.
- member-resolver: view uses logical names only (per-game-filter report §4 — never prefixed in YAML); prefix
  physicalization happens at request boundary on prod. Nothing to hardcode.

## Related Code Files
- Modify: `cube-dev/cube/model/views/cfm/user_360.yml`, `cube-dev/cube/model/views/jus/user_360.yml`
- Modify: all phase 2–5 cube YAMLs (add freshness tag + `meta` block to descriptions)
- Read/verify only: `src/pages/Catalog/use-catalog-meta.ts` (confirm no allowlist; if gated, add new cubes there)
- Possibly modify: `src/pages/Catalog/*` ONLY if auto-discovery turns out to be gated (verify first, don't assume)

## Implementation Steps
1. Verify catalog auto-discovery: load `/meta?extended=true` with `x-cube-game: cfm` after phases 2–5; confirm
   new cubes appear in Catalog with no code change. If gated by an allowlist, add the logical names there.
2. Extend `views/cfm/user_360.yml`: add joins + curated dims/measures from each new cube (payer recency/tier,
   geo-stability, churn-gap, CSAT, VIP, acquisition channel). Keep the 360 spine focused — don't dump every member.
3. Mirror for `views/jus/user_360.yml`.
4. Apply freshness tag: ensure EVERY new cube description starts `[freshness: ...]` + add `meta: { freshness, source }`.
5. Compile both games; load user_360 in Playground; confirm new members queryable + only that game's rows return.
6. Confirm chat-agent sees freshness tag (spot-check meta payload) — guards live-vs-historical guidance.

## Todo List
- [ ] Verify catalog auto-discovery (no allowlist) OR register logical names
- [ ] Extend cfm user_360.yml with new members
- [ ] Extend jus user_360.yml with new members
- [ ] Freshness tag + meta on every new cube
- [ ] Compile + Playground load both games
- [ ] Chat-agent freshness-tag spot check

## Success Criteria
- New members browsable in Catalog + queryable via user_360 in Playground, per game.
- Every new cube carries a parseable freshness tier in description + meta.
- No cross-game leak; logical names only in YAML.

## Risk Assessment
- **Catalog gated by allowlist (assumption wrong)** (Low×Med): new cubes invisible. Mitigate: step 1 verifies before assuming.
- **user_360 bloat** (Med×Low): 360 view becomes unwieldy. Mitigate: surface only decision-relevant members, not all.
- **Freshness tag unparsed by chat** (Med×Med): chat gives wrong live/historical advice. Mitigate: structured `meta` + spot check.

## Security Considerations
- View inherits cube `public: false` on PII dims — verify no PII dim leaks into user_360.
