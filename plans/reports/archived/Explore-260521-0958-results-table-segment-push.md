# Exploration: Results Table Rendering & Segment-Push Capability

**Date:** 2026-05-21 09:58  
**Scope:** Understand how `/build` route results table renders and segment-push capability  
**Status:** COMPLETE

---

## 1. Results Table Rendering

### Route Architecture
- **Route path:** `/build` (hash-based SPA)
- **Route component:** `/src/pages/Explore/ExplorePage.tsx` (line 1–29)
  - Renders `<QueryBuilderContainer>` which wraps the full query builder UI
  - Delegates to `<QueryTabsRenderer>` for tab switching (Results / Chart / SQL / JSON)

### Results Table Component
**File:** `/src/QueryBuilderV2/QueryBuilderResults.tsx` (1,478 lines)

#### Table Rendering Structure (lines 688–1476)
- **Container:** `<Panel>` with sticky header, paginated grid layout
- **Data source:** `resultSet?.loadResponse?.results[0].data` — array of objects (line 723–726)
- **Pagination:** 100 rows per page (line 933, 1368)
- **Grid columns:** Built from `orderedColumnNames` = dimensions + timeDimensions + measures (line 742–750)

#### Row Data Shape
Each row is a `Record<string, unknown>` with keys like:
```
{
  "active_daily.log_date": "2026-05-21",
  "mf_users.first_login_date": "2026-04-15",
  "mf_users.arpu_vnd": 125000,
  "mf_users.user_count": 42,
  ...
}
```
- Dimensions and time dimensions use dot notation (`cube.member`)
- Time dimensions append granularity suffix (line 995: `timeDimension.dimension + '.' + timeDimension.granularity`)
- Cell rendering is type-aware (currency, percent, numbers, dates — lines 873–905)

#### Selection Column (Lines 754–793)
When an identity dimension is detected, a leading **checkbox column** appears (40px wide):
- **Selection enabled when:**
  - `saveBarMode === 'uid'` — identity dimension IS in results (each row is a user)
  - `saveBarMode === 'expansion'` — identity dimension exists in cube config but NOT in results (rows are cohorts, needs materialization)
  - Both modes determined by `inferCubeAndIdentity()` and `inferIdentityGap()` (lines 757–764)
- **Row keys:** Computed via `getRowKey()` — either the identity-field value or a hash of non-identity dims (lines 778–788)

#### No Per-Row Action Menu
The results table has **no dropdown menu or action button per row** (line 116–129 shows column header option buttons only). Row selection is exclusively via checkbox; actions live in the floating `SegmentsSaveBar` below the table.

---

## 2. Segment-Push Flow

### A. Selection & Floating Action Bar
**File:** `/src/QueryBuilderV2/segments-save-bar/segments-save-bar.tsx` (1–185 lines)

When rows are selected:
- **Bar appears** when `data.length > 0 && saveBarMode` (line 1463–1474)
- **Shows:**
  - Selection count + mode hint (identity-uid vs expansion)
  - `Clear` button (lines 150–152)
  - `Copy IDs` (uid-mode only, clipboard → newline-separated uids, line 155–157)
  - `Export CSV` (uid-mode only, with identity-field header, lines 158–160)
  - **`Save as Segment` button** (primary, triggers modal, line 164–166)

### B. Push Modal (Create or Append)
**File:** `/src/pages/Segments/push-modal/push-modal.tsx` (1–313 lines)

#### Two-Tab Modal
1. **Create New (default tab)**
   - Name input (required, line 242–247)
   - Type choice:
     - **Static** — stores snapshot of UIDs at creation time (line 260–262)
     - **Live** (expansion-mode only) — predicate-based, refreshed on cron (line 264–276)
   - On submit: calls `segmentsClient.create()` with `SegmentInput` (line 140–147)

2. **Append to Existing**
   - Dropdown select from existing static segments (lines 291–299)
   - On submit: calls `segmentsClient.append(targetId, finalUids)` (line 168)

#### UID Resolution (Identity vs Expansion)
- **Identity-uid mode:** `uids` prop contains UIDs directly; used as-is (line 107)
- **Expansion mode:** `resolveUids()` callback runs at submit time (line 102–108, 109–121)
  - Materializes UIDs from selected cohort rows via follow-up Cube Query
  - Prevents client-side UID explosion for aggregated queries

#### Predicate Building (Live Type)
- **File:** `/src/QueryBuilderV2/segments-save-bar/build-predicate-from-rows.ts`
- **Callable when:** `type === 'predicate'` (line 128–137)
- **Builds:** Canonical AND/OR tree capturing:
  - Original query filters
  - Time dimension date ranges (with rolling semantics)
  - OR-of-AND across selected cohort rows (non-identity dims only)
- **Example output:** 
  ```
  AND(
    filter1, filter2,
    inDateRange(date_dim, "this week"),
    OR(
      AND(country=US, brand=Game1),
      AND(country=JP, brand=Game2)
    )
  )
  ```

#### Summary Display
- **Expansion mode:** "N cohort(s) selected — user_ids will be materialized at save" (line 212–216)
- **Identity mode:** "N user IDs selected" (line 217)
- **Breakdown:** Top categorical dimension values (count) + avg of first numeric column (lines 219–233)

### C. Backend API Target
- **POST `/api/segments/create`** — accepts `SegmentInput` (name, type, cube, uid_list, predicate_tree, refresh_cadence_min)
- **POST `/api/segments/:id/append`** — merges uids into existing static segment
- **Backend:** Fastify + better-sqlite3 at `:3001` (Vite proxy `/api → :3001`)
- **Server code:** `server/src/routes/` handles schema, tree↔CubeQuery translation, cron refresh

---

## 3. Identity Field Configuration

**Hook:** `/src/hooks/use-identity-map.ts`
- Caches `/api/identity-map` response (per-cube identity-field mappings)
- Exported functions: `identityFieldFor(cube)` and `hasIdentityFor(cube)`
- Used at line 756–760 to decide if selection column renders

**Setup:** `/src/pages/Segments/identity-map/` route (`/segments/identity-map`)
- Maps cubes to identity dimensions (manual config via Settings UI)
- Required for segment push to work

---

## 4. Data Flow Summary

```
User selects rows in /build Results table
    ↓
Checkbox column computes row keys (uid or hash)
    ↓
SegmentsSaveBar appears with selection count
    ↓
User clicks "Save as Segment"
    ↓
PushModal opens
    ├─ Create tab:
    │  ├─ Name + type (Static or Live)
    │  └─ If Live: buildPredicateFromRows() → tree
    │
    └─ Append tab:
       └─ Select target segment from dropdown
    ↓
At submit:
    ├─ Identity mode: use selected UIDs directly
    └─ Expansion mode: resolveUids() → run Cube Query on cohort rows
    ↓
segmentsClient.create() or .append()
    ↓
POST /api/segments/* → backend persists

User can later:
- Open segment in /segments/[id] detail view
- Edit predicate in /segments/[id]/edit
- Pin analyses to segment
```

---

## 5. Recent Commits & Documentation

### Key Commits
| Hash | Message | Date |
|------|---------|------|
| 7434939 | `feat(segments): Deactivate affordance on activation cards` | Latest |
| 078c931 | `feat(segments): expansion-mode save bar for aggregated Playground results` | 2026-05-21 |
| 80e0c66 | `feat(segments): first-class redesign — game-context, library compaction, 5-tab detail, editor workspace, activate-to-CDP` | 2026-05-21 |
| 64272e8 | `feat(server): MM-01 proxy route for CDP metrics activation` | 2026-05-21 |

### Plan Reference
- **Master plan:** `plans/260519-1610-query-results-to-segments/`
  - 9-phase execution (P0–P8), mostly complete
  - Phase 2 covers FE row-select + push modal + library
  - Phases 5–6 cover predicate editor + cron refresh

### Docs
- `docs/codebase-summary.md` — brief segments/backend overview
- `docs/project-changelog.md` — detailed changelog of all segments phases + API routes
- `docs/journals/` — implementation journals (e.g., 2026-05-19 segments P0/P1 foundation)

---

## 6. Current Capability Assessment

### What Exists Today
✅ Row selection (checkbox column) when identity dimension configured  
✅ Floating save bar with Clear / Copy / Export / Save as Segment  
✅ Push modal with Create (Static + Live) and Append tabs  
✅ UID resolution (direct or via expansion query)  
✅ Predicate tree builder for Live segments  
✅ Backend API (create, append, list)  
✅ Identity-map configuration UI  
✅ Segment library, detail, editor routes  

### What Is Missing (Not Yet Implemented)
❌ **Per-row action menu** (no "Save row to segment" context menu on individual rows)  
❌ **Bulk actions UI** beyond Select All / Clear  
❌ **Activate to CDP** (server route exists at 64272e8, but FE integration for segment→CDP push is not complete)  
❌ **Visual regression tests** (P0 polish deferred)  
❌ **Dark mode for segments** (light-only in v1)  

### Capability for User Request ("Push Row to Segment")
**Today:** User must manually check rows then click "Save as Segment"  
**Next step:** Add per-row context menu or quick-save button (e.g., "Save to segment" option in row OptionsButton or right-click menu) — would feed directly into PushModal with that single row pre-selected.

---

## 7. Files & Line References

| Component | File | Key Lines |
|-----------|------|-----------|
| Results table (render + selection) | `src/QueryBuilderV2/QueryBuilderResults.tsx` | 688–1476 |
| Selection state & row key logic | `src/QueryBuilderV2/segments-save-bar/use-results-selection.ts` | 1–152 |
| Floating action bar | `src/QueryBuilderV2/segments-save-bar/segments-save-bar.tsx` | 1–185 |
| Push modal (UI & logic) | `src/pages/Segments/push-modal/push-modal.tsx` | 1–313 |
| Predicate builder | `src/QueryBuilderV2/segments-save-bar/build-predicate-from-rows.ts` | 1–177 |
| Expansion query (uid materialization) | `src/QueryBuilderV2/segments-save-bar/expand-rows-to-uids.ts` | — |
| Identity-map hook | `src/hooks/use-identity-map.ts` | — |
| Route definition | `src/index.tsx` | 102–104 (KeepAliveRoute for /build) |
| ExplorePage (entry point) | `src/pages/Explore/ExplorePage.tsx` | 1–29 |

---

## 8. Unresolved Questions

1. **Activate to CDP integration:** Commit 64272e8 adds proxy route `/api/cdp/v1/metrics`. Is there FE UI in detail/editor pages that calls it? (Likely yes per 80c066 commit message, but not verified in this pass.)
2. **Cube identity field required?** Can a user push rows if identity field is not configured? (Current code: selection column hidden, but rows selectable? Needs verification.)
3. **Live segment auto-refresh UI:** Does the FE show refresh status/progress in segment detail? (Backend cron exists; FE polling likely in phase 6, status message observed in changelog.)

