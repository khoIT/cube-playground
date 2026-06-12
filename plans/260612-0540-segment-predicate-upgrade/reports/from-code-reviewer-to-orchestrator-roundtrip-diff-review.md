# Code Review — segment-predicate-upgrade working-tree diff (phases 2–5)

Reviewer: code-reviewer | Date: 2026-06-12 | Scope: uncommitted diff in `/Users/lap16299/Documents/code/cube-playground` (20 modified + 14 untracked files, ~1.4k LOC added)

## Verdict: REQUEST_CHANGES

Server-side work (PATCH precedence) is solid and well-tested. The FE tree→query mapper has two correctness bugs that break the core round-trip deliverable, plus a cluster of majors where red-team amendments are implemented in letter but not in effect on the common (inline) path.

Test runs: FE 169/169 pass (12 suites incl. all new). Server sidecar suite 14/14 pass. Full server: 4 failures in `test/preagg-readiness.test.ts` — pre-existing, registry-size assertions unrelated to this diff. Typecheck: no errors in any diff file (repo baseline has unrelated pre-existing errors).

---

## CRITICAL

### C-1: `in`/`notIn` tree leaves produce invalid Cube operators — boot query fails
`src/pages/Segments/predicate-tree-to-cube-query.ts:72` forwards `leaf.op` verbatim into the filter. Cube has no `in`/`notIn` filter operators; the server translator maps them (`server/src/services/translator.ts:36-37` — "Cube uses 'equals' for multi-value (IN)"). The FE mapper must mirror this.

Impact chain: `buildPredicateFromRows` promotes multi-value equals → `in` leaves (`build-predicate-from-rows.ts:108`). So ANY segment saved from the playground with a multi-value filter gets an `in` leaf; reopening it via "Open in Playground" boots a query Cube rejects. The round-trip breaks on its second pass for the most common predicate shape. The unit tests assert the wrong behavior (`predicate-tree-to-cube-query.test.ts:44,52` expect `operator: 'in'`).

Fix: map `in → equals`, `notIn → notEquals` in `leafToFragment` (values already plural); fix the two test assertions. Round-trip stays lossless because `cubeFilterToNode` re-promotes multi-value equals → `in`.

### C-2: OR-group flattening destroys nested AND/OR structure — silent cohort widening on save-back
`predicate-tree-to-cube-query.ts:106-116`: for an OR group, ALL descendant leaf filters are flattened into one `{ or: [...] }`. `OR(AND(a,b), c)` becomes `or(a, b, c)` — strictly wider. Time-dim leaves inside OR are also hoisted to top-level timeDimensions (AND semantics).

Impact: expansion-born segments are exactly `AND(filters…, OR(AND(row dims…), …))` (see `build-predicate-from-rows.ts:190-198`) — deeplinking one shows a widened cohort, and a zero-edit Update persists the widened predicate. The translatability gate cannot catch this (all operators are individually translatable). This is the C3 failure class the gate was built to prevent, reintroduced one layer down.

Fix: make `treeToQueryFragment` recursive-structural like server `nodeToCubeFilter` (`translator.ts:136-146`): AND child group → `{and:[...]}`, OR child group → `{or:[...]}`; only the root AND flattens. Decide explicitly what to do with time-ops inside OR groups (server wraps them as dateRange filters inside the compound — mirror that, or gate-block trees with time ops under OR).

---

## MAJOR

### M-1: Member catalog reads `cube.joins` from SDK `meta()` which strips joins — joined-cube members never appear
`use-predicate-member-catalog.ts:93,162` calls `cubejsApi.meta()` and reads `joins`. Prior art at `src/QueryBuilderV2/hooks/query-builder.ts:371-381` documents that the SDK call strips `joins[]`/`connectedComponent` (requires raw fetch with `?extended=true`). Result: `joinedNames` is always empty, catalog = primary cube only. Phase-2 acceptance criterion 1 ("active_daily dims + mf_users dims with group headers") fails at runtime; the unit test passes because it feeds fixture cubes with joins directly. Fix: replicate the extended-meta fetch (or share the helper).

### M-2: Inline deeplink path ships a gutted edit context — echo strip + game guard ineffective on the common path
`playground-deeplink.ts:110-113` documents an `?edit-context=` param for the inline path; it is never emitted (URL is `query=` + `edit-segment=` only, `:263-265`) and no consumer exists (grep: only comments). `QueryBuilderContainer.tsx:374-380` then builds `minimalCtx` with `echoFilters: []` and `gameId := ACTIVE game`. Consequences on every inline deeplink (the dominant path — definitions are small by design):
- Echo filters never stripped at save-back (`stripEchoFilters` no-ops on empty list).
- Game-mismatch guard can never fire: `ctx.gameId === active gameId` by construction, and `gameMismatch` is computed once at boot (`QueryBuilderContainer.tsx:124`) and never re-evaluated on mid-session game switch — so the brief's "game-mismatch guard blocks save" mitigation does not hold here.
Fix: either implement the `?edit-context=` param, or always write the edit context to sessionStorage (both paths), or populate `gameId`/echo record from the `segmentsClient.get` fetch already performed at `:140-156`.

### M-3: Echo record covers only `<segment.cube>.gameId`; `applyGameFilter` injects per EVERY referenced cube
`playground-deeplink.ts:249-251` records one echo. `apply-game-filter.ts:48-58` appends a filter for each referenced cube with a `gameId` dim (measures cube, identityDim cube, timeDimension cubes, segment cubes). E.g. identityDim `mf_users.user_id` on an `active_daily` segment → `mf_users.gameId` echo survives stripping and is persisted into the predicate on save-back. Moot today only if no local cube exposes `.gameId`; the mechanism is wrong regardless. Fix: record echoes for the same cube set `applyGameFilter` derives (share `collectReferencedCubes`).

### M-4: C2 relative-date freeze leaks back in via the boot normalizer for non-day units
`QueryBuilderContainer.tsx:432` runs `normalizeQueryRelativeDateRanges` on the deeplinked query: "last N week/month/quarter/year" tree literals are expanded to literal `[start,end]` tuples before execution; save-back persists the tuple → rolling window frozen. "last 30 days" survives (day-unit passes through), so the headline b7a6cae9 case works, but month/quarter predicates freeze — exactly the C2 failure the plan amended phase 4 to prevent. Side effect of the same block: `history.replace` (`:446`) rewrites search to `?query=` only, silently dropping `edit-segment` from the URL (refresh loses edit mode). Fix options: skip normalization rewrite when `edit-segment` present and instead record the original→normalized mapping for save-back reversal; or have save-back consult the original tree literals.

### M-5: Empty-predicate save-back unguarded — one click redefines segment to match-everyone
User deletes all filters in edit mode → `buildPredicateFromRows` yields `AND([])` → gate returns ok (tested: "returns ok=true for an empty query") → PATCH succeeds → `treeToCubeFilters` returns `[]` (`translator.ts:163-167`) → next refresh widens to all users (modulo sidecar). The editor path guards with `isTreeValid`; the playground Update path has no equivalent. Fix: block Update (tooltip) when the produced tree has zero leaves, mirroring the editor's `validPredicate` gate.

### M-6: saved-analyses "Open in Playground" silently dropped uid-IN member scoping
`saved-analyses-tab.tsx:40-57` now opens the raw analysis query with NO uid overlay. Previously the analysis ran scoped to segment members. Phase 4 said migrate the dead-path caller (sessionStorage consumer now exists for exactly this), not change semantics. Also leaves `buildPlaygroundDeeplink`/`mergeUidFilter`/`defaultBaseQuery` with zero production callers while the module header (`playground-deeplink.ts:6-10`) claims saved-analyses still uses them — dead code + false doc. Fix: restore the overlay via `buildPlaygroundDeeplink` (its overflow path now works), or get explicit user sign-off on the semantic change and delete the dead exports.

### M-7: Phase 4/5 acceptance test gaps
- Phase-4 checkbox "edit-segment context available to the save bar (asserted via test)" — no test covers QueryBuilderContainer param consumption / edit-session provisioning.
- Phase-5 test list: "edit-mode rendering, update payload shape, manual→live confirm" — none implemented (only echo-strip + round-trip property tests exist).

---

## MINOR

1. Plan-label violations: three "phase 5" comment references in `QueryBuilderContainer.tsx` (~:80, :99, :345). Reword to describe behavior ("save-back flow"). All other new files clean.
2. `segments.ts` refresh equality: PATCH `cube_segments: null` when stored sidecar is already empty → `JSON.stringify(null) !== "[]"` → spurious refresh enqueue. Normalize null→[] before compare.
3. Case (a) with `predicate_tree: null` + `cube_segments` present silently discards the segments (query nulled). Consistent-but-undocumented; consider 400 like case (b).
4. `playground-edit-segment-banner.tsx:39` uses `var(--info-soft)` (background token) as text color — should be `--info-ink`. Mostly masked by child-span colors.
5. Hardcoded EN strings without `t()`/defaultValue: banner copy, chips header/tooltips/Modal.confirm, save-bar manual→live Modal + updateTooltip strings. Codebase pattern is `t(key, { defaultValue })`.
6. `cube-segment-scope-chips.tsx:55-58`: a stored primary-cube segment missing from /meta (model drift) is classified as cross-cube → rendered locked, can never be removed via chips.
7. `value-input.tsx`: (a) component swaps Input→AutoComplete when suggestions arrive mid-focus → focus loss while typing; (b) multi-value `in`/`notIn` branch gets no suggestions though phase-2 spec listed them; (c) `use-dim-value-suggestions` keeps stale `suggestions` state when `member` changes (no reset effect) → wrong-dim suggestions until next focus; (d) no unmount cancellation on the async setState.
8. `predicate-leaf.tsx:88-94`: custom-member escape via Select `onBlur` reading the internal search input value — depends on antd v4 internals; verify it actually fires (antd clears search text on blur in some configs).
9. `detail-header-actions.tsx:57-63` / identityDim fallback: `segment.cube == null` yields member `'.user_id'` in the boot query (garbage member; visible Cube error, no crash). Also `buildDefinitionDeeplink` is executed during render — on the oversize path it writes sessionStorage as a render side effect on every render.
10. `saved-analyses-tab.tsx:30`: `usePreset(segment)` retained for side effect only — dead fetch, remove (YAGNI).
11. Save-bar comment contradiction (`segments-save-bar.tsx` ~:209 vs :221): one comment says updates are allowed while fetch in-flight, the code hides the button. Keep the code, fix the comment.

## Verified OK (review-gate checklist)

- **PATCH precedence (f1)**: cases a/b/c/d implemented per spec with comments; 400 guard for tree-less cube_segments-only PATCH (incl. manual segments) — tested; canonical sort + equality check prevents no-op refresh — tested; carry-forward when omitted — tested; `cube_segments` joined the administer-gated field list — tested non-owner 403. Type-conversion validation (aad460a) runs before the DB write; visibility gating untouched.
- **Echo strip exact-match (f2)**: requires member AND operator AND values (order-insensitive, string-coerced) — `echo-filter-stripper.ts:52-63`. Coincidental user filter with different values survives. Correct per design.
- **Gate superset (f3)**: `TRANSLATABLE_FILTER_OPS` is byte-identical to `CUBE_TO_TREE_OP` keys; every op the builder nulls (notContains/startsWith/endsWith/in/notIn/notInDateRange/measure-filter shapes) is blocked — 31 gate tests incl. each nulled op and nested and/or recursion. Granularity-only timeDimensions conservatively blocked. (Note: gate ok=true for empty query feeds M-5.)
- **Relative-date preservation (f4)**: `treeToQueryFragment` forwards "last 30 days" unexpanded (tested) — but see M-4 for the boot-normalizer bypass on week/month/quarter/year units.
- **Plain `?query=` boot (f5)**: byte-identical — new param blocks are guarded on their own params; `rawQuery` fallthrough adds only a null-coalesced clause; normalizer/replace effect unchanged.
- **identityDim fallback (f6)**: wrong member → Cube validation error surfaced in builder UI, no app crash; editor path prefers identity-map (`use-identity-map`) before falling back. See minor #9.
- **Accepted gap severity (f7)**: intra-session cube/query switch keeping edit mode is riskier than the brief assumes, because the claimed game-mismatch backstop is ineffective on the inline path (M-2) and absent for same-game query swaps. The visible banner + can_administer gate are the only real mitigations. Recommend phase 6 binds edit context to the booted query hash.
- **Contracts (c)**: `SegmentPatch` additions optional; PATCH schema additive; `?edit-segment` additive. `?edit-context` documented but missing (M-2).
- **Patterns (d)**: tokens used throughout (one misuse, minor #4); antd v4 `Modal visible` correct for pinned 4.16.13; kebab-case naming; module-level caches with in-flight dedupe mirror `autoPresetCache` pattern; i18n gaps noted (minor #5).
- **Types/tests (e)**: zero type errors in diff files; all new FE suites + server sidecar suite green; 4 server failures pre-existing (`preagg-readiness`, registry-size drift).

## Recommended fix order

1. C-1 + C-2: rewrite `treeToQueryFragment` mirroring server `nodeToCubeFilter` (op mapping + recursive structure); fix test assertions; add OR-of-AND and in/notIn round-trip tests.
2. M-5: empty-tree Update guard (small, high blast radius).
3. M-2 (+M-3): persist full edit context on both paths; derive echo set from `collectReferencedCubes`; re-evaluate `gameMismatch` reactively.
4. M-4: edit-mode-aware handling of the boot normalizer.
5. M-1: extended-meta fetch in catalog hook.
6. M-6: decision needed — restore uid overlay vs sign off semantic change; either way remove dead exports/stale docs.
7. Minors batch (comments, i18n, token, suggestion-hook polish) + M-7 missing tests during phase 6.

## Unresolved questions

1. Do any local-workspace cubes currently expose a `.gameId` dimension? Determines whether M-3 is live or latent (mechanism wrong either way).
2. Was dropping the uid-IN overlay on saved analyses (M-6) a deliberate product decision discussed outside the plan? Plan text says "migrate the caller", not "change semantics".
3. For time-ops nested under OR groups: should phase 6 gate-block them, or mirror the server's compound-filter encoding? Server `treeToCubeFilters` supports date ops inside `{or}` via filter-form `inDateRange`; FE could too.
