# Scout Report: Preset Installer Wizard & Segment Overlap Compare

**Date:** 2026-05-22 | **Breadth:** Medium

## 1. Curated Preset Storage — Backend Persistence Path

**Current State:** Presets live FE-only in TypeScript.
- **Registry:** `src/pages/Segments/presets/registry.ts` — static `PRESETS` object with hardcoded curated presets.
  - Contains `mfUsersHubPreset` and `rechargeEventsPreset` — no runtime addition.
  - `getPreset(id)` and `getPresetByHubCube(cube)` lookups — read-only.
- **Server Route:** `server/src/routes/presets.ts:25` — GET `/api/presets` returns static array.
  - Type: `server/src/types/preset.ts` — `Preset` schema.
  - **No write endpoint exists** — presets cannot be created/saved via API.
- **Segment Model:** `server/src/types/segment.ts` — Segment has NO `preset_id` field.
  - Segment stores `cube` (string), `predicate_tree_json`, `uid_list_json` only.
  - No foreign key or reference to presets table.
- **Database Schema:** No `presets` table found in migration or schema files.

**Findings:**
- Presets are TS-only bundles; **NO backend persistence** exists.
- To enable auto→curated preset conversion + persistence:
  1. Add `preset_id: string | null` column to `segments` table + migration.
  2. Create `POST /api/segments/:id/preset` endpoint to update segment's preset_id.
  3. Migrate `PRESETS` from `src/pages/Segments/presets/registry.ts` to server DB (or keep static + allow lookup by id).
  4. Add preset validation in PATCH endpoint (verify preset exists before saving).

---

## 2. Cube Metadata Endpoint — Hook & Fetch Path

**Hook:** `src/pages/Segments/detail/use-preset.ts:79` — `useCubejsApi(apiUrl, token)`
- **Implementation:** `src/hooks/cubejs-api.ts:4–14` — wraps `@cubejs-client/core` cubejs() factory.
- **API Method:** `cubejsApi.meta()` called in `use-preset.ts:61`.
  - Returns `{ cubesMap?: Record<string, CubeMetaCube> | cubes?: CubeMetaCube[] }`.
  - Both formats handled in `metaToResponse()` — line 42.
- **Cube Metadata Structure:** `CubeMetaCube` interface (line 33):
  - `name: string`
  - `measures?: CubeMetaField[]` — array of `{ name, type?, title? }`
  - `dimensions?: CubeMetaField[]` — same shape.
- **Cache:** Module-level `autoPresetCache` (line 25) — per-cube name.

**Findings:**
- Cube metadata is fetched on-demand via Cube.js `/meta` API (internal to SDK).
- All dims/measures accessible via `meta.cubes[cube].dimensions` and `.measures`.
- No preset list endpoint on Cube.js side — presets are our own TS registry.

---

## 3. Segment Overlap/Compare Endpoint — Status

**Search Results:**
- `server/src/jobs/refresh-segment.ts` — computes overlap *internally* during refresh:
  - Line 17: `const overlap = uids.length - added;`
  - Line 19: `const overlapRatio = prevUids.length ? overlap / prevUids.length : 1;`
  - **Used for logging only** — overlap % logged on refresh; not exposed via API.
- No compare endpoint found in `server/src/routes/segments.ts`.
- No `intersect`, `uid_overlap`, or `compare-segments` route.

**Finding:** **No segment overlap/compare endpoint exists.** Would need to:
1. Add `POST /api/segments/:id/compare/:otherId` → returns intersection, union, size deltas.
2. Or batch: `POST /api/segments/compare` with `{ ids: [id1, id2, ...] }` → pairwise metrics.

---

## 4. Segments List Endpoint — Cube Filter Parameter

**Endpoint:** `server/src/routes/segments.ts:70–99`
- **Query Params:**
  ```
  owner?, type? ('manual'|'predicate'), q (name search), game_id?
  ```
- **NO cube filter.** Client: `src/api/segments-client.ts:21–27`
  ```ts
  export interface ListSegmentsParams {
    owner?: string;
    type?: SegmentType;
    q?: string;
    sort?: 'name' | 'recent' | 'size';
    game_id?: string;
  }
  ```

**Finding:** To build segment compare picker filtered by cube, add `cube?: string` parameter to `/api/segments`:
- Server: Update SQL to `WHERE cube = ?` if provided.
- Client: Add `cube` to `ListSegmentsParams`.

---

## 5. Existing Wizard/Multi-Step Modal Patterns

**Found Example:** `src/QueryBuilderV2/NewMetric/full-page/shell/step-chrome.tsx`
- **Pattern:** Step number + title + subtitle header; styled body; sticky footer with nav buttons.
- **Components:**
  - `StepNum` (uppercase, muted) — "Step 2 of 5"
  - `Title` (font-size 20px, weight 600)
  - `Sub` (smaller, secondary color)
  - `Body` (flex: 1, overflow-y auto, padding 20px 24px)
  - `FooterBar` (sticky, bottom: 0, nav buttons on right)
  - `NavBtn` (styled button with optional `$primary` and `$disabled` flags)
  - Navigation: ChevronLeft/ChevronRight icons from lucide-react

**Style System:** Uses CSS custom properties (`--border-card`, `--bg-app`, `--text-primary`, etc.)

**Preset Installer UI Should:**
- Mirror step-chrome structure.
- Steps: (1) Select target cube, (2) Pick auto-preset dims/measures, (3) Name curated bundle, (4) Confirm save.

---

## 6. Vietnamese Locale Audit — Missing Keys & defaultValue Usage

### Locale Completeness
- `en.json`: 323 lines
- `vi.json`: 322 lines
- **Gap check:** Missing `segments.detail.tabs` keys in `vi.json`:55 lines 112–125 exist in en.json but NOT in vi.json.
  - Missing in vi: none detected; key structure mirrors.
- However: `segments.detail.tabs` **exists in vi.json:167–180** — moved after `detail.actions`.

**Critical Gaps in vi.json:**
1. **Line 139:** `"noContent": "No content for this section."` — untranslated English.
2. **Line 140:** `"subPills": "Insights sections"` — untranslated English.
   - en.json 154–155 has these translated in vi as:
     - Line 154 en: `"subPills": "Insights sections"`
     - **NOT in vi.json** — missing entries entirely.

### defaultValue Fallbacks — Top 10 in Segments/Preset Context

All 149 `defaultValue:` occurrences include fallback English. Top segment-related:

1. `src/QueryBuilderV2/segments-save-bar/segments-save-bar.tsx:116` — `defaultValue: '{{count}} IDs copied'`
2. `src/QueryBuilderV2/segments-save-bar/segments-save-bar.tsx:121` — `defaultValue: 'Clipboard unavailable'`
3. `src/QueryBuilderV2/segments-save-bar/segments-save-bar.tsx:177` — (multiline, selection count)
4. `src/QueryBuilderV2/segments-save-bar/segments-save-bar.tsx:182` — `defaultValue: '{{count}} cohort(s) selected…'`
5. `src/pages/Segments/library/library-meta-line.tsx:45` — `defaultValue: 'never'`
6. `src/pages/Segments/library/library-meta-line.tsx:50` — `defaultValue: '{{count}} segments'`
7. `src/pages/Segments/library/library-meta-line.tsx:53` — `defaultValue: '{{count}} users'`
8. `src/pages/Segments/library/library-meta-line.tsx:55` — `defaultValue: 'last refresh {{when}}'`
9. `src/pages/Segments/library/library-view.tsx:103` — `defaultValue: 'Health'`
10. `src/pages/Segments/library/library-view.tsx:106` — `defaultValue: 'Used in'`

**Note:** 144 of 149 defaultValue uses are in segments-related code — indicates heavy inline fallback usage vs. i18n table coverage.

---

## Unresolved Questions

1. **Preset installer wizard design:** Should conversion happen inline (edit → new preset screen) or separate modal flow?
2. **Preset persistence scope:** Store in DB or rebuild on-demand from segment + Cube metadata? (DB cleaner but requires migration + API.)
3. **Segment overlap feature:** Single compare or bulk pairwise? (Bulk simpler; single compare more flexible.)
4. **i18n gaps:** Should `segments.detail.insights.subPills/noContent` be added to vi.json, or deprecated?
