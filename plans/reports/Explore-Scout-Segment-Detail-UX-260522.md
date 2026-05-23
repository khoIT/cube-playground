# Scout Report: Segment Detail Page UX Improvements

**Scope:** Medium-thorough structural survey of Segment Detail page prior to planning 7 UX enhancements.

**Target UX Features:**
1. Activation summary chip in header
2. Broken-error drill-down
3. KPI sparklines on cards
4. Insights loading skeletons
5. Refresh-now spinner overlay
6. Members tab search/sort
7. Predicate definition tree view

---

## 1. Detail Header Layout

**File:** `src/pages/Segments/detail/detail-view.tsx`

### Header Structure (lines 138–193)
- **Breadcrumbs:** line 139–143 (static nav back to library)
- **Title row structure:** lines 145–193
  - `<h1 className={styles.detailTitle}>` — segment name, line 146
  - **Cube badge:** line 147–149 — `{segment.cube != null && <span className={styles.cubeBadge}>{segment.cube}</span>}`
  - **Auto-preset chip:** lines 150–159 — `{preset?.auto && <span className={styles.autoPresetChip}>Auto preset</span>}` — renders as a styled info chip with tooltip
  - **Live badge:** lines 160–162 — `{segment.type === 'predicate' && <LiveBadge intervalMin={...} />}`
  - **Status pill:** line 163 — `<StatusPill status={segment.status} reason={segment.broken_reason} />`
  - **Spacer & actions:** lines 164–192
    - **Refresh-now button:** line 166 — `<RefreshNowButton segment={segment} />`
    - **Copy as filter button:** lines 167–182
    - **Edit predicate button:** lines 183–188
    - **Delete button (danger):** lines 189–191 — `<Button danger onClick={() => setDeleteOpen(true)}>Delete segment</Button>`

### Activation Chip Placement
**Open question:** Activation summary chip (e.g., "3 active destinations") should go between status-pill and spacer (after line 163, before line 164) or in the actions row. No explicit placeholder yet.

---

## 2. KPI Cards Strip

**File:** `src/pages/Segments/detail/detail-view.tsx` lines 196–233

### Card Rendering
- If `preset?.headlineKpis.length > 0` (preset available):
  - Maps preset KPI specs → `<KpiCard />` components, lines 198–207
  - Each receives `spec`, `segment`, `preset`, cache key, optional `comparison`
- Fallback (no preset): renders 4 hardcoded `<KpiTile />` components (Size, Last refresh, Owner, Status)

**KpiCard component file:** `src/pages/Segments/detail/cards/kpi-card.tsx` lines 31–56
- Fetches data via `useSegmentCubeQuery` hook
- Synchronous hydration via `initialRows` from `segment.card_cache[cacheKey]`
- **Loading state:** value = `'…'` (three dots)
- **Error state:** value = `'—'` (em dash)
- No visible skeleton or structured loading indicator — just text placeholder

### Refresh Log Access for KPI Sparklines
**Endpoint:** `segmentsClient.refreshLog(segmentId, days?, limit?)` — returns `RefreshLogRow[]`
- Defined in `src/api/segments-client.ts` line 66–71
- Usage example: `src/pages/Segments/detail/tabs/monitor/size-trend-section.tsx` line 56 — calls `refreshLog(segment.id, days, 500)`
- **RefreshLogRow schema** (`src/types/segment-api.ts` lines 101–107):
  - `id: number`
  - `segment_id: string`
  - `ts: string` (ISO timestamp)
  - `uid_count: number` (segment size at refresh)
  - `status: string` (e.g., 'fresh', 'broken')
  - **No `error` field** — error details live in `Segment.broken_reason`, not per-row

---

## 3. Refresh Log & Activations

**Refresh history endpoint & client:**
- `segmentsClient.refreshLog(segmentId, days, limit)` — `src/api/segments-client.ts:66`
- Returns paginated refresh-log rows (uid_count + status per timestamp)

**Activation data:**
- Embedded in `Segment.activations[]` (type: `Activation[]`)
- Schema: `src/types/segment-api.ts` lines 81–91
  - `id`, `destination`, `env`, `metric_name`, `registered_at`, `last_pushed_at`, `status`, `last_error?`

**Activation card list rendering:**
- **Monitor tab (summary):** `src/pages/Segments/detail/tabs/monitor/activation-summary-section.tsx` — renders `segment.activations` as compact `<ul>` with metadata, line 52–66
- **Full Activation tab:** `src/pages/Segments/detail/tabs/activation-tab.tsx` — renders detailed cards per activation, lines 104–142
  - Each card shows destination, metric, timestamps, optional error banner (line 120–123)

---

## 4. Broken-Segment Banner

**File:** `src/pages/Segments/detail/components/broken-segment-banner.tsx` (full file)

### Current Implementation
- Renders `<Alert type="error">` only when `segment.status === 'broken'`
- **Message:** `This segment is broken: {{segment.broken_reason ?? 'unknown error'}}`
- **CTA button:** "Edit predicate to fix"
- Appears at top of detail-view, before header, line 137 of detail-view.tsx

### Data Available for Drill-Down
- `segment.status` ('fresh' | 'refreshing' | 'broken' | 'stale')
- `segment.broken_reason` (nullable string) — only source of error details in segment object
- **Refresh log row error details:** None — `RefreshLogRow` has no error/reason field; only `status` field

**Issue:** To drill down on which refresh failed + why, need to surface `broken_reason` from latest failed refresh-log row, but schema doesn't have that. Current broken banner only shows `segment.broken_reason` (global state), not historical per-refresh errors.

---

## 5. Refresh-Now Button

**File:** `src/pages/Segments/detail/components/refresh-now-button.tsx` (full file)

### Implementation
- Renders only for `segment.type === 'predicate'` (line 16)
- **Action:** `segmentsClient.refresh(segment.id)` — enqueues manual refresh via POST (line 21)
- **Loading state:** Button has `loading={pending || segment.status === 'refreshing'}` (line 35)
  - Uses AntD `<Button>` with icon + loading spinner
  - Callback: `onOptimistic?.()` (optional) allows caller to update UI optimistically

### Spinner Placement
- Button is in header actions row (line 166 of detail-view.tsx)
- Spinner already appears on button itself via AntD's `loading` prop
- **No overlay spinner on KPI cards during refresh** — cards only show loading state internally (value = `'…'`)

---

## 6. Members Tab

**File:** `src/pages/Segments/detail/tabs/members-tab.tsx` lines 21–52

### Current Implementation
- Static header with title + identity chip + Export button (lines 26–41)
- No search or sort controls
- Delegates to `<SampleUsersTab />` (line 49)

**Sample Users Table:** `src/pages/Segments/detail/tabs/sample-users-tab.tsx` lines 53–160

### Rendering & Pagination
- Uses **custom HTML `<table>` element**, not AntD Table (lines 104–134)
- **Pagination:** manual via state `[page, setPage]` — buttons on lines 137–145
  - Page size: 25 rows (`PAGE_SIZE`)
  - Sample size: 50 total users (`SAMPLE_SIZE`)
- **Sorting:** None — random sample via seed shuffle (line 55, line 87–90 reshuffle button)
- **Search:** None — no uid/row filtering

### Member Dimension Fetching
**Hook:** `useMemberDimRows(segment, preset, pageRows)` — `src/pages/Segments/detail/tabs/use-member-dim-rows.ts` lines 33–75
- Accepts `uids: string[]` (current page UIDs)
- Returns `{ byUid: Map<string, Record>, loading, error, columns }`
- Columns fetched from `preset.memberColumns` (dimension + measure specs)

### Table Markup
- **Column headers:** line 106–112 — index, uid, then dynamic cols from preset
- **Rows:** lines 115–132 — fetch from `byUid` map, format cell values
- **Loading state:** line 125–127 — shows `'…'` per cell while `dimsLoading && !dimRow`

---

## 7. Predicate Definition / Tree View

### Definition Tab Header & Identity Card
**File:** `src/pages/Segments/detail/tabs/definition-tab.tsx` lines 21–69

- Identity section (lines 28–52): Cube, Identity dim, Refresh cadence (read-only `<dl>`)
- Predicate section header (lines 55–65): title + "Edit predicate" button
- Wraps `<PredicateTab />` inside definition-tab (line 66)

### Predicate Tree Renderer (Read-Only)
**File:** `src/pages/Segments/detail/tabs/predicate-tab.tsx` (full file 71–105)

### Current Implementation
- **Segment type check:** line 74–80 — manual segments show info note, returns early
- **Empty state:** line 84–91 — no tree = info note
- **Tree render:** `<NodeTree />` recursive component (lines 39–68)
  - Group nodes render operator label + children with depth-based indent (lines 59–67)
  - Leaf nodes render as: `<code>member</code> op values` (lines 26–36)
  - Indent via `marginLeft: depth * 16` (line 61)

### Data Source
- `segment.predicate_tree` — root `PredicateNode` (schema in `src/types/segment-api.ts` lines 28–44)
- Discriminator: `node.kind === 'group'` (GroupNode) vs leaf (LeafNode)
- GroupNode.op: 'AND' | 'OR'
- LeafNode fields: member, op, values (already visible)

### No Tree-View Component Yet
- Current implementation is custom nested divs + CSS indent
- No expandable/collapsible tree UI or drag-to-edit (read-only)
- **Candidate for upgrade:** swap custom `<NodeTree />` for a formal tree-view library or add expand/collapse chevrons

---

## Cross-Cutting Observations

### Loading Skeleton Patterns
- **Detail header:** lines 91–100 use custom `.skeletonRow` CSS class with pulse animation
  - Defined in `src/pages/Segments/segments.module.css` (pulse animation, neutral background)
  - **No AntD Skeleton import found** in detail/ files
  - Existing pattern: `<div className={styles.skeletonRow} style={{...}} />`
- **Card loading:** CardShell shows solid gray box (line 29 of card-shell.tsx), not skeleton rows

### Insights Tab Loading
**File:** `src/pages/Segments/detail/tabs/insights-tab.tsx` lines 26–84

- Delegates to `<PresetTab />` which maps cards to `<LineChartCard>`, `<BarListCard>`, etc.
- Each card component uses `CardShell` with `loading` prop (internal gray box, no skeleton)
- No loading skeletons per card type defined yet

### Status & Tone System
- Status pill (line 163): uses `<StatusPill status={segment.status} reason={...} />`
- Activation status uses `data-tone` attribute: 'success' | 'destructive' | 'muted' (activation-tab.tsx line 106, activation-summary-section.tsx line 59)
- Refresh history status uses `data-tone` (refresh-history-section.tsx line 81)

---

## File Inventory for Modifications

### Core Detail Flow
- `src/pages/Segments/detail/detail-view.tsx` — header, KPI strip, tab routing
- `src/pages/Segments/detail/components/refresh-now-button.tsx` — refresh CTA + loading state
- `src/pages/Segments/detail/components/broken-segment-banner.tsx` — error banner

### KPI & Card Components
- `src/pages/Segments/detail/cards/kpi-card.tsx` — KPI value + optional comparison + skeleton
- `src/pages/Segments/detail/cards/card-shell.tsx` — card header + body + loading state
- `src/pages/Segments/detail/cards/line-chart-card.tsx` — line chart + data fetch
- `src/pages/Segments/detail/cards/bar-list-card.tsx` — bar chart variant
- `src/pages/Segments/detail/cards/donut-card.tsx` — donut chart variant
- `src/pages/Segments/detail/cards/composition-card-component.tsx` — composition chart variant

### Tab Components
- `src/pages/Segments/detail/tabs/monitor-tab.tsx` — aggregates size + history + activation sections
- `src/pages/Segments/detail/tabs/monitor/size-trend-section.tsx` — size sparkline + trend
- `src/pages/Segments/detail/tabs/monitor/refresh-history-section.tsx` — refresh-log table
- `src/pages/Segments/detail/tabs/monitor/activation-summary-section.tsx` — compact activation list
- `src/pages/Segments/detail/tabs/activation-tab.tsx` — full activation cards
- `src/pages/Segments/detail/tabs/insights-tab.tsx` — preset tab routing
- `src/pages/Segments/detail/tabs/preset-tab.tsx` — KPI grid + card grid render
- `src/pages/Segments/detail/tabs/members-tab.tsx` — header + delegates to SampleUsersTab
- `src/pages/Segments/detail/tabs/sample-users-tab.tsx` — table + pagination (no search/sort)
- `src/pages/Segments/detail/tabs/definition-tab.tsx` — identity section + predicate section
- `src/pages/Segments/detail/tabs/predicate-tab.tsx` — tree render (custom nested divs)

### Data & API
- `src/api/segments-client.ts` — `refreshLog()`, `refresh()`, `appendActivation()`, `removeActivation()`
- `src/types/segment-api.ts` — Segment, RefreshLogRow, Activation schemas

### Styles
- `src/pages/Segments/segments.module.css` — `.skeletonRow` (pulse animation), detail layout classes

---

## Unresolved Questions

1. **Activation summary chip placement:** Should the "3 active destinations" chip appear next to status-pill or in actions row? Consider screen real-estate at mobile sizes.

2. **Broken-error drill-down data:** RefreshLogRow schema has no `error` field — where should drill-down store per-refresh error reasons? Extend schema or fetch on-demand from a separate endpoint?

3. **KPI sparkline data:** RefreshLogRow provides `uid_count + ts`, sufficient for a mini sparkline. Should sparklines always show 7/30/90-day trends, or configurable per KPI spec?

4. **Members tab search scope:** Search by uid substring only, or also searchable by member-dimension columns (e.g., "find users from Germany")? Affects query scope.

5. **Refresh overlay spinner:** When refresh-now is clicked, should KPI card values "greyed out" or hide while refreshing? Current behavior is button spinner only.

6. **Predicate tree UI:** Should tree be expandable/collapsible, or stay fully expanded read-only? If expandable, default state (all collapsed / expanded)?

7. **Insights skeleton granularity:** Per-card skeleton (matching card height), or generic "loading…" text like current KpiCard placeholder?

