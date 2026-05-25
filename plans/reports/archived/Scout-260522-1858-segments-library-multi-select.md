# Scout Report: Segments Library Multi-Select & URL State

**Breadth:** Medium | **Date:** 2026-05-22

---

## 1. Current Library Row Layout

**Row wrapper:** `<Link>` to `/segments/:id` (not div+onClick)
- File: `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/library/library-segment-row.tsx:27`
- Click stops at Link level — row navigates on click anywhere

**Row action cell:** Single kebab menu button with stop propagation
- File: `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/library/row-actions-menu.tsx:32-34`
- Click handlers use `e.preventDefault() && e.stopPropagation()` to prevent Link navigation

**Grid template columns (7 columns):**
```
minmax(280px, 2.4fr) 130px 90px 110px 200px 120px 40px
```
- File: `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/segments.module.css:96,112`
- Columns: Segment | Health | Size | Trend | Destinations | Owner | Actions
- Row is `<Link>` wrapper with flex+grid children. `.tableRow:112` is the grid container.

**Multi-select will need:** Checkbox column (prepend to row) → 8 total columns. Header:line `101`. Row:line `27`.

---

## 2. Client APIs (segments-client.ts)

**Available methods:**
- `list(params)` — query params: owner, type, q, sort ('name'|'recent'|'size'), game_id
  - File: `/Users/lap16299/Documents/code/cube-playground/src/api/segments-client.ts:30-32`
- `get(id)` — fetch single segment
  - File: `segments-client.ts:34-36`
- `delete(id)` — delete single segment → Promise<void>
  - File: `segments-client.ts:49-51`
- `refresh(id)` — single refresh (POST /api/segments/:id/refresh)
  - File: `segments-client.ts:60-64`
- `update(id, patch)` — partial update (PATCH). Patch schema includes `tags` array
  - File: `segments-client.ts:42-47` + server schema `segments.ts:28-35`
- `append(id, uids)` — append UIDs to segment
  - File: `segments-client.ts:53-58`

**No bulk endpoint exists.** Manual loop required for delete/refresh/tag bulk ops.

---

## 3. Tag Editing

**Tag shape:** `string[]` field on Segment type
- File: `/Users/lap16299/Documents/code/cube-playground/src/types/segment-api.ts:63`

**Tag display in library row:**
- Renders first 4 tags using Tag component from visuals
- File: `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/library/library-segment-row.tsx:33-39`

**Tag UI component:**
- File: `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/visuals/tag.tsx`
- Read-only pill rendering at line 10 (displays tag text)
- Optional `onRemove` callback for editable context (line 6)
- Styles: `.tag` (height 20px, padding 0 7px) + `.tagRemove` button (12×12, 50% opacity)
  - File: `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/visuals/visuals.module.css:77-104`

**Tag storage:** Server stores in `segment_tags` table (separate rows per segment+tag)
- File: `/Users/lap16299/Documents/code/cube-playground/server/src/routes/segments.ts:42-44`

**Server bulk tag update:** Only supports per-segment update via PATCH /api/segments/:id with tags array
- File: `server/src/routes/segments.ts:28-35` (segmentPatchSchema includes tags field)

**No bulk tag edit UI exists.** Detail page (not scouted) may have tag editing.

---

## 4. URL State (Query Params)

**Library view does NOT persist state to URL.**
- File: `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/library/library-view.tsx`
- State lives in React state: `query`, `filter`, `sort` (lines 32-34)
- No `useLocation()` or URLSearchParams used in library
- No `useHistory.push()` to update query params on state change

**Detail tab (not library) DOES use URL state:**
- File: `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/detail/use-active-tab.ts`
- Uses URLSearchParams to read/write active tab (lines 7, 15, 19)

**Toolbar search/sort:** Zero URL persistence
- File: `library-toolbar.tsx:24-56`
- All state is callback-driven, no history updates

**Conclusion:** Library needs full URL sync added (search, filter pill, sort). No existing pattern; detail tab shows the pattern.

---

## 5. Refresh Endpoint

**Single refresh (live segments only):**
- Endpoint: `POST /api/segments/:id/refresh`
- Returns: `{ status: 'refreshing' }` (202)
- File: `server/src/routes/segments.ts` (grep output shows POST /api/segments/:id/refresh)
- Client method: `segmentsClient.refresh(id): Promise<{ status: string }>`
  - File: `segments-client.ts:60-64`

**Bulk refresh logs (different endpoint):**
- `POST /api/segments/refresh-logs` (bulk fetch for library sparklines)
- File: `segments-client.ts:73-78`
- Accepts list of IDs, returns map of ID → RefreshLogRow[]

**Single refresh log:**
- `GET /api/segments/:id/refresh-log`
- File: `segments-client.ts:66-71`

**No bulk refresh trigger exists.** Each segment must be refreshed individually.

---

## 6. Empty State

**Text:** `segments.library.empty` (translation key, rendered as-is from i18n)
- File: `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/library/library-view.tsx:119`
- Rendered in `.emptyState` div (segments.module.css:171-176)
- Shown when `segments != null && filtered.length === 0`

**Styling:** 48px padding, center-aligned, secondary text color, 13px font
- File: `segments.module.css:171-176`

---

## 7. Trend Column Tooltip

**Sparkline component:** `TrendCell`
- File: `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/library/cells/trend-cell.tsx`

**ARIA label (tooltip-equivalent):**
- Generated dynamically from i18n + series data
- File: `trend-cell.tsx:54-58`
- Pattern: `t('segments.library.trend.aria', { defaultValue: 'Size trend {{delta}}% over {{points}} refreshes', delta, points: series.length })`
- Applied to SVG element: `aria-label={ariaLabel}` (line 67)

**Sparkline rendering:** 80×28 SVG with path stroke
- File: `trend-cell.tsx:61-71`
- CSS class: `.trendSparkline` (display: block)
  - File: `segments.module.css:913-915`

---

## Open Questions

- Q1: Should checkbox column prepend (leftmost) or append? Current actions col is rightmost (40px fixed).
- Q2: Bulk delete — should there be a confirmation modal with count, or individual confirmations?
- Q3: Bulk tag/export — should these launch a modal UI (e.g., tag picker, export format selector), or inline operations?
- Q4: URL state — does filter pill and sort also need to be persisted, or only search query + active page?
