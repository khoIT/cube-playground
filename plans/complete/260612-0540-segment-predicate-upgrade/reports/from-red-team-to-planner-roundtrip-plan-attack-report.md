# Red-team attack report — segment predicate upgrade plan (260612-0540)

Reviewer: code-reviewer (hostile mode). All evidence grep/read-verified against live code 2026-06-12.

## CRITICAL

### 1. `cube_identity_map` is GLOBAL — phase 1 seeding rebinds identity for 7 games, not jus_vn
- **Claim attacked**: phase-01 "Seed cube_identity_map rows anchoring every jus_vn cube" — scoped to jus_vn.
- **Evidence**: `server/src/db/migrations/001-init.sql:42-49` — `cube TEXT PRIMARY KEY`, no game/workspace column. Lookup `server/src/services/resolve-identity-field.ts:111` is `WHERE cube = ?` on logical name. `active_daily` cube exists in **7 game dirs**: `cube-dev/cube/model/cubes/{jus,cfm,muaw,ballistar,pubg,tf,cros}/active_daily.yml`. Same for `mf_users`, likely `user_roles` etc. The PUT route (`identity-map.ts:197`) stores prefix-stripped logical keys — i.e. the seed also hits prod prefix-workspace cubes of every game.
- **Failure scenario**: seed `active_daily → mf_users.user_id` for jus → any cfm_vn/muaw/etc. segment on `active_daily` silently re-anchors at next refresh. cfm joins `user_id = user_id` plain (`cfm/active_daily.yml:11-14`) in the vopenid identity namespace — different dedup semantics, different uid space; cfm cohorts re-cohort without anyone asking. FE pivot (`use-preset.ts:96-100`) also flips for those games. Plan's "only b7a6cae9 lives on these cubes today" is asserted for jus only — unverified for other games.
- **Amendment**: phase 1 step 0 = collision audit: list segments per game on each cube name to be seeded; verify each game's mf_users join semantics, or explicitly accept cross-game rebinding in the PR. Longer-term: raise (game, cube) scoping of `cube_identity_map` as a follow-up decision — do NOT seed shared cube names until decided.

### 2. Rolling windows freeze into literal dates on round-trip — permanent semantic loss
- **Claim attacked**: phase-04 "reuse the stored cube_query_json (source of truth) ... no FE re-translation needed"; phase-05 "tree produced must round-trip ... modulo canonical ordering".
- **Evidence**: `treeToCubeFilters` expands relative single-value `inDateRange` ("last 30 days") into explicit `[start,end]` at save time (`translator.ts:114-131`, called at `segments.ts:373` create / `:609` PATCH). So stored `cube_query_json` holds FROZEN dates while `predicate_tree` keeps the relative literal. Phase 4 deeplinks from `cube_query_json` → playground shows frozen tuple → phase 5 `buildPredicateFromRows` persists the frozen tuple into the NEW tree (`build-predicate-from-rows.ts:121-133` keeps values verbatim). The relative literal is gone from the source of truth forever.
- **Failure scenario**: "pc online last 30 days" → open in playground → add one filter → Update → segment is now "pc online 2026-05-13..2026-06-11" forever; every cadence refresh re-runs the stale window; nobody notices until the cohort quietly stops moving. (Side note: refresh already uses stored `cube_query_json` directly — `refresh-segment.ts:157` — so the window only re-anchors on meta-version drift rehydration; the round-trip makes even that unrecoverable because the TREE itself loses the literal.)
- **Amendment**: build the deeplink filters from `predicate_tree` (FE-side translation preserving relative literals — Cube's playground accepts `inDateRange` relative strings in timeDimensions; or carry the tree alongside and merge non-time leaves only). Alternatively tag relative leaves in the edit context and re-fuse on save-back. Add a fidelity-matrix row: relative-window predicate survives a round-trip as a relative window.

### 3. "Block Update when untranslatable" has NO detection seam — current code silently drops filters
- **Claim attacked**: phase-05 risk "block Update with explanatory tooltip when query contains untranslatable constructs, never silently drop".
- **Evidence**: `build-predicate-from-rows.ts:44-57` `CUBE_TO_TREE_OP` lacks `notInDateRange` (server tree SUPPORTS it — `translator.ts:60`), `startsWith`, `endsWith`, `notContains`, `notStartsWith`, `notEndsWith` (all valid Cube playground operators). `cubeFilterToNode` returns `null` for unknown ops (`:103-104`) and callers `.filter()` nulls away (`:179-181`) — silent drop, no error, no flag.
- **Failure scenario**: segment has `notInDateRange` exclusion (server created it fine) → open in playground → Update without touching anything → exclusion leaf vanishes → cohort silently WIDENS → refresh fires → CDP activation pushes the wrong audience. Matrix row 5 only covers "measure filter w/ grouping" — this class is invisible to it.
- **Amendment**: phase 5 must create an explicit `assessQueryTranslatability(query): {ok, unsupported: [...]}` util (shared op-map with build-predicate-from-rows), gate Update on it, and add `notInDateRange` to the FE map (the tree already supports it — free fidelity win). Test: every Cube operator the playground UI can emit is either mapped or listed as blocking.

## MAJOR

### 4. Edit context is URL-scoped but queries are TAB-scoped — wrong-query overwrite
- **Evidence**: playground is multi-tab (`QueryBuilderContainer.tsx:250-282`, `QueryTabs`); the save bar receives the ACTIVE tab's `executedQuery` (`QueryBuilderResults.tsx:1610-1618`); phase 4 stashes `{segmentId}` in container state from the URL param, which persists across tab switches.
- **Failure scenario**: user opens segment in playground (tab A), switches to a prior saved tab B (unrelated revenue query), hits the still-visible "Update <segment>" → segment redefined by tab B's query, auto-refresh fires.
- **Amendment**: bind the edit context to the tab id created at boot; banner + Update render only on that tab.

### 5. Save-bar render gates make Update unreachable for the planned boot query
- **Evidence**: bar renders only when `executedQuery && data.length > 0 && saveBarMode` (`QueryBuilderResults.tsx:1609`); `saveBarMode` comes from identity inference (`:829-833`): identity dim in query → 'uid', else identity-configured-but-absent → 'expansion', else null. Expansion mode is visible only after ≥1 row CHECKBOX selection (`segments-save-bar.tsx:104`).
- **Failure scenario**: phase 4's own mitigation ("boot with measures-only, identity dim not pre-selected") → identity dim absent → mode='expansion' → Update hidden until the user checkbox-selects a cohort row, which is meaningless for editing. Also: a definition narrowed to 0 matches returns no rows → bar hidden → cannot save the narrowing. Also: pre-phase-1, `active_daily` has no identity-map row → mode may be null entirely — contradicts plan.md "1–3 independent of 4–5".
- **Amendment**: in edit mode, render the bar whenever `editContext && executedQuery` — bypass mode/rows/selection gates; spec this in phase 5. Note phase 5's runtime dependency on phase 1 for the b7a6cae9 demo path.

### 6. `applyGameFilter` echo gets persisted into the predicate
- **Evidence**: boot query passes through `applyGameFilter` (`QueryBuilderContainer.tsx:234,268`) which appends `{member:'<cube>.gameId', operator:'equals'}` for cubes exposing gameId (game_id-model workspaces). `executedQuery` includes it; `buildPredicateFromRows` faithfully converts it into a tree leaf.
- **Failure scenario**: every round-trip on a game_id workspace bakes a `<cube>.gameId equals <game>` leaf into the stored predicate. Redundant at best; wrong at worst if the segment is later opened under a different active game (the injected filter is idempotent per-cube in the QUERY, but the persisted leaf is permanent and the next boot injects against the leaf's presence).
- **Amendment**: strip the injected game filter on save-back — deterministic (known member + value from boot context), same mechanism as finding 7.

### 7. Identity-echo strip heuristic misfires both ways — replace with deterministic tagging
- **Claim attacked**: phase-05 "strip any leaf on the identity dim with op in/equals ... value count is large; keep deliberate small identity filters".
- **Evidence/analysis**: predicate-segment deeplinks carry NO identity echo at all (filters come from `cube_query_json` — phase 4 design), so the strip only ever applies to manual edit-targets, where the deeplink only inlines when small (URL ≤8000 chars, `playground-deeplink.ts:51`). "Large" is undefined; a 300-uid manual list both fits the URL and looks "large".
- **Failure scenarios**: (a) manual segment, 3 uids: the IN-list IS the definition; stripping it yields an EMPTY tree → manual→live conversion creates a match-everyone segment → unbounded Trino scan (the exact footgun phase 3's confirm guards against) → refresh of the whole population. (b) user deliberately pastes a 200-uid whitelist filter while editing → stripped silently → cohort explodes. (c) NOT stripping a small manual echo is actually CORRECT (live segment pinned to those ids) — the heuristic solves a non-problem and creates two real ones.
- **Amendment**: the deeplink builder KNOWS what it injected — store `{member, valuesHash}` in the edit context, strip only an exact match on save-back. Zero heuristics. If the echo is the only content after strip, block Update ("definition is empty").

### 8. Phase 3 chips silently drop cross-cube sidecar entries
- **Evidence**: sidecar can hold OTHER cubes' segments — `segments.ts:65-69` documents `mf_users.whales` as the canonical example; `editor-view.tsx:55,73` parses whatever is stored. Phase 3 renders chips for "the cube's model-defined segments" (primary cube only) and "Save persists the chip set".
- **Failure scenario**: active_daily segment with `mf_users.whales` sidecar → editor shows only active_daily's last_7d/last_30d/yesterday chips → save sends primary-cube chip set → whales entry dropped → membership silently widens from whales to everyone. Exactly the "silent widening" phase 3 says the owner-gate prevents — but here the OWNER does it unknowingly.
- **Amendment**: chip set = union of (primary cube's model segments) + (any stored sidecar entries, cross-cube ones rendered as removable-but-explicit chips); save payload must round-trip entries the picker doesn't know.

### 9. Phase 3 PATCH interplay underspecified — five concrete gaps
- **Evidence**: PATCH handler `segments.ts:605-693`.
  1. **Both fields in one patch**: predicate branch (`:613-615`) re-attaches the sidecar from the STORED row (`parseCubeSegments(row.cube_query_json)`). If `patch.cube_segments` is also present, ordering must make the patch win — otherwise old sidecar overwrites the new chips in the same request. Plan doesn't state the precedence.
  2. **cube_segments alone on a row with `cube_query_json = null`** (manual segment, or predicate cleared): `withCubeSegments({filters: ???})` has nothing to wrap → must 400 or rebuild from the stored tree.
  3. **Refresh trigger**: `predicateChanged` (`:659-662`) requires `patch.predicate_tree !== undefined`; cube_segments-only change won't enqueue refresh NOR set `status='refreshing'` (`:663`) without explicit extension. Plan says "same auto-refresh trigger" — spell out both writes.
  4. **Authz**: `touchesAdministerField` (`:592-596`) must gain `patch.cube_segments !== undefined`, else any workspace member redefines the cohort via chips (route guard is only 'mutate').
  5. **Contradiction**: non-functional "untouched segments keep byte-identical cube_query_json.segments" vs "sort canonically" — canonical sort changes bytes for any already-stored unsorted sidecar. Pick one (suggest: sort only when the field is explicitly patched).

### 10. "Definition query: small, always inlineable" — false; and a missed deeplink consumer
- **Evidence**: expansion-mode pushes store OR-of-AND trees across all selected rows (`build-predicate-from-rows.ts:190-198`) — dozens of rows × several dims easily exceeds the 8000-char URL after `encodeURIComponent`. Also `src/pages/Segments/detail/tabs/saved-analyses-tab.tsx:43` calls `buildPlaygroundDeeplink` and is absent from phase 4's Related Code Files — "remove the dead from-segment path" either breaks its compile or leaves the half-wired branch alive there (violating phase 4's own non-functional requirement).
- **Amendment**: keep a sessionStorage handoff for oversize definitions — the consumer pattern already exists (`?from-chat-artifact`, `QueryBuilderContainer.tsx:177-217`); reuse it as `?from-segment-definition=<id>`. Add saved-analyses-tab to the migration list (it also wants definition semantics now that frozen-uid is retired — decide its fate explicitly).

### 11. Workspace/game context mismatch on deeplink — no handling
- **Evidence**: /build boots under the ACTIVE game (`useActiveGameId`) and workspace (`QueryBuilderContainer.tsx:144,254`); the segment carries its own `game_id`/`workspace`. Stored `cube_query_json` on prefix workspaces holds PHYSICAL member names (e.g. `ballistar_mf_users.user_id`).
- **Failure scenario**: user has cfm_vn active in the header, opens a jus_vn segment detail (or pastes a shared deeplink) → playground /meta has different cubes → builder renders missing-member errors at best; at worst the query runs against a same-named cube of the wrong game, user hits Update, and the jus segment is redefined by cfm semantics + an injected cfm gameId filter. Phase 6 matrix has no row for this.
- **Amendment**: deeplink carries `game_id` (+ workspace); the consumer either switches context or blocks with a toast ("switch to jus_vn to edit this segment"). Add matrix row.

## MEDIUM / MINOR

### 12. URL normalization rewrite drops `edit-segment`
- `QueryBuilderContainer.tsx:246` — `history.replace({ search: '?query=...' })` replaces the WHOLE search string when relative ranges normalize. Today's definition queries have no timeDimensions so it rarely fires, but saved-analysis queries do. Cheap fix: preserve existing params in the replace. Phase 4's "purely additive" requirement should call this out.

### 13. Measure-filter semantics shift between playground and refresh
- Refresh replaces `dimensions` with the identity dim only (`refresh-segment.ts:166-173`); a measure filter's implicit HAVING group changes from the playground's dim-combo to per-identity. Query LOOKS like "count > 5 per (user, platform)" in playground, refresh evaluates "count > 5 per user". Matrix row 5's blocking rule needs a precise definition: block when filters reference a /meta measure AND the executed query had non-identity dimensions.

### 14. Phase 2 "joined cubes" via connectedComponent over-offers
- cubejs /meta exposes `connectedComponent`, not join edges/direction; nearly every jus cube shares one component through mf_users. Picker would offer sibling fact cubes (e.g. `user_recharge_daily` dims on an `active_daily` segment) where no join PATH exists → predicate saves fine, refresh /load 400s → segment broken. Suggest v1 allowlist: primary cube + its direct join targets parsed from… nothing FE-visible — so primary + `mf_users` (identity anchor) only, expand later.

### 15. FE `SegmentPatch` type lacks `type` AND `cube_segments`
- `src/types/segment-api.ts:185-194`. Phase 5 payload sends both; plan only mentions cube_segments. Trivial but will bite tsc.

### 16. Phase 1 second-order effects unlisted
- (a) Save-bar identity inference flips for `active_daily` playground queries everywhere (`QueryBuilderResults.tsx:816-833`): a query on `active_daily.user_id` stops being uid-mode (identity now `mf_users.user_id`) — existing push-flow UX changes. (b) Nightly segment-membership lakehouse snapshot will record ~100% churn delta for re-cohorted segments — downstream Iceberg consumers see a full membership replacement with no annotation. Flag both in the PR.

### 17. Phase 1 join probe proves compile, not correctness
- `split_part(user_id,'@',1)` (jus `active_daily.yml:14`) merges channel-namespaced ids; distinct `uid@gas` / `uid@fb` users can collapse into one mf_users uid. `seen.has` dedup in refresh (`refresh-segment.ts:214`) makes paging safe, but `total: true` count (`:175-189`) counts DISTINCT identity values post-join — verify count query and page dedup agree. Step 5's delta check is the right guard — make it a blocking success criterion with a stated tolerance, not "documented and explained".

### 18. Stale edit context: type may have changed under you
- Phase 5's manual→live confirm keys off the type snapshot fetched at deeplink build time. Another admin converts/redefines meanwhile → wrong dialog, or `predicate_tree` PATCH on a now-manual segment flips it back to predicate unintentionally (PATCH allows it). Re-fetch the segment immediately before Update; base the confirm + payload on current state. (403/404 handling already planned — extend to type drift.)

### 19. Pre-gate Update on `can_administer`
- Hydration exposes it (`segments.ts:279`); the deeplink source (detail page) already has the segment object. Threading it into the edit context costs nothing and avoids offering a primary action that can only 403 (matrix row 6 then tests the defense-in-depth path, not the primary UX). Local AUTH_DISABLED = admin masks this in dev — prod-only bug shape.

## Fidelity-matrix gaps (phase 6 additions)
- Relative-window predicate round-trips as relative (finding 2).
- `notInDateRange` / unsupported-operator round-trip is BLOCKED, not silently dropped (finding 3).
- Cross-cube sidecar (`mf_users.whales`) survives chip save + playground round-trip (finding 8).
- Deeplink under mismatched active game blocks/switches (finding 11).
- Multi-tab: Update unavailable on non-edit tabs (finding 4).
- Manual segment whose entire definition is the uid IN-list: Update blocked or converts to pinned-id live, never empty predicate (finding 7).

## Unresolved questions
1. Is the relative-window freeze in stored `cube_query_json` (refresh never re-translates the tree; only drift rehydration does) known/accepted, or a latent bug to fix alongside finding 2? The fix choice for the round-trip depends on it.
2. Should `cube_identity_map` gain (game, cube) scoping BEFORE phase 1 seeds cube names shared by 7 games, or is global rebinding acceptable for active_daily/user_roles-class names?
3. Phase 3 scope: are joined cubes' segments (mf_users.whales) toggleable chips, or preserved-but-read-only? Affects findings 8/9 amendments.
4. saved-analyses-tab deeplinks: migrate to definition mode, or keep uid-IN semantics for analysis replay?
