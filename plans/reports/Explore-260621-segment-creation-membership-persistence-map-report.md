# Segment Creation, Membership Refresh & Persistence Flow Map

## 1. Data Model (SQLite schema)

### Core Segments Table (migration 001-init.sql:2-20)
- **Primary fields:**
  - `id` (TEXT): UUID
  - `type` (manual|predicate): segment kind
  - `status` (fresh|refreshing|broken|stale): cohort state
  - `cube` (TEXT): primary cube for predicate queries
  - `predicate_tree_json` (TEXT): canonical AND/OR tree (server/types/predicate-tree.ts:95-111)
  - `cube_query_json` (TEXT): compiled {filters, dimensions, segments} for Cube /query
  - `uid_count` (INTEGER): population size from last successful refresh
  - `uid_list_json` (TEXT): [uid1, uid2, ...] for manual segments
  - `refresh_cadence_min` (INTEGER): re-run cohort every N minutes
  - `last_refreshed_at` (DATETIME): timestamp of last successful refresh
  - `broken_reason` (TEXT): error on broken status

### Related Tables
- **segment_tags** (011): tag→segment N:M
- **segment_analyses** (001): saved Cube queries pinned in segment
- **cube_identity_map** (001): cube → identity_field mapping (e.g., mf_users.user_id)
- **segment_snapshot_log** (048-segment-snapshot-log.sql:9-18): heartbeat log of lakehouse writes
  - Tracks (snapshot_date, segment_id, game_id, row_count, status)
- **segment_member_profiles_json** (046): top-1000 members enriched via rank measure + preset columns
- **segment_card_cache** (051/057/058): KPI card state + cache (status ok|error, last_good value, error breadcrumb)

---

## 2. Predicate Tree: Types & Compilation

### Type Hierarchy (server/src/types/predicate-tree.ts + server/src/types/predicate-tree.ts)

```
PredicateNode = GroupNode | LeafNode

GroupNode: { kind: 'group', op: 'AND'|'OR', id, children: PredicateNode[] }
LeafNode:  { kind: 'leaf', member: string, type: LeafValueType, op: LeafOperator, values: unknown[], id }

LeafOperator includes:
  Direct:     equals, notEquals, gt, gte, lt, lte, in, notIn, contains, set, notSet
  Derived:    dateWithinLast, dateBeforeLast (relative dates → absolute at query time)
  Time:       inDateRange, beforeDate, afterDate
  Statistical: percentileGte, percentileLte (two-pass cutoff resolution)
```

### Percentile Operator
- **Value shape:** `{ p: number (1-99), over?: { table?, column?, filter?: PredicateNode, identityMerge?: { idColumn, transform: 'split_part_at' } } }`
- **Two-pass:** POST /api/segments/resolve-cutoff (server/src/routes/segments.ts:591) computes cutoff value, then leaf compiles to scalar gte/lte against that cutoff
- **Reference population:** optional PredicateNode filter (e.g., "top quartile among payers"); defaults to full source population
- **Identity merge:** for multi-row tables like jus_vn (split_part identity), collapse to per-user before percentiling

### Compilation Paths
1. **Tree → Cube Query** (src/pages/Segments/predicate-tree-to-cube-query.ts:168)
   - Root AND: children become top-level filter entries (implicit AND)
   - Nested OR/AND: emitted as boolean filter format { or:[], and:[] }
   - Time ops at root: promoted to timeDimensions; inside OR groups: stay as filter entries
2. **Tree → SQL** (server/src/services/predicate-to-sql.ts): used for lakehouse snapshot writes
3. **Cube Query → Tree** (reverse, for editor prefill): buildPredicateFromRows unpacks Cube filters

---

## 3. Membership Refresh Flow

### Trigger Points
- **Manual:** POST /api/segments/:id/refresh (segment-refresh-ops.ts:109—"unstick" override)
- **Scheduled:** cron-runner.ts ticks every 5m, enqueues due segments to refresh-queue.ts
- **On create:** segment auto-enters status='refreshing', cron picks it up next tick

### Refresh Job (server/src/jobs/refresh-segment.ts)
1. Load segment row + cube_query_json
2. Call Cube /query with stored filters + segments + identity dimension only
3. Paginate results (MAX_ROWS capped sample, not full cohort)
4. Write to SQLite segments.uid_list_json + update uid_count + status='fresh'
5. Trigger card-refresh cycle if member_profiles needed

### Membership Snapshot (nightly / on-demand)
- **Job:** server/src/jobs/snapshot-segment-membership.ts
- **Target:** stag_iceberg.khoitn.segment_membership_daily (Trino Iceberg table)
- **Path:**
  1. Compile segment membership SQL (buildSegmentMembershipSql, server/src/lakehouse/segment-snapshot-writer.ts:112)
  2. Cross-catalog INSERT…SELECT via Trino REST (writeSegmentSnapshot:139)
  3. Log result to segment_snapshot_log (snapshot_date, segment_id, game_id, row_count, status)
- **Idempotent:** DELETE partition by (snapshot_date, segment_id) before INSERT

### Count Derivation
- **estCount (in-app estimate):** Cube query's returned row count (capped sample, not true size)
- **uid_count (on screen):** stored in segments table after refresh; feeds the Members tab row count
- **actual_count (lakehouse truth):** full cohort size from segment_membership_daily partition (read for lakehouse exports)

---

## 4. Segment Editor UI (src/pages/Segments/editor/)

### Editor Workflow
1. **Identity Card** (editor-view.tsx:73-90):
   - Pick cube (loads /meta member catalog for predicate builder dropdown)
   - Name the segment
   - Set visibility (personal|shared|org; org requires admin)

2. **Predicate Builder** (predicate-builder/predicate-leaf.tsx, predicate-group.tsx):
   - **Member picker:** grouped Select from /meta catalog (group=cube, members by type)
   - **Type selector:** string|number|time|boolean (auto-set from meta)
   - **Operator dropdown:** operatorsFor(type) → (direct, derived, statistical classes)
   - **Value input:** type-specific:
     - string: AutoComplete with dim-value suggestions
     - number: InputNumber
     - time: plain Input or date-range multi-select
     - percentile: dual inputs (p%, reference population table)
     - derived-date: n + unit (days/weeks/months)

3. **Supported Predicate Shapes:**
   - ✅ Single leaf (member op value)
   - ✅ AND tree (root AND, arbitrary nesting)
   - ✅ OR tree (root OR, nesting preserved)
   - ✅ Percentile leaves (two-pass via /resolve-cutoff)
   - ✅ Derived-date leaves (relative offsets resolved at query time)
   - ❌ Compound percentile (e.g., "top 25% among users in top 10%") — not exposed in builder UI
   - ❌ Percentile inside OR groups (translatability gate blocks save-back)

4. **Refresh Behaviour** (refresh-behaviour-card.tsx):
   - Set cadence_min (how often to refresh cohort)
   - Cube-segment scope (read-only sidecar, preserved on every edit)

5. **Prefill Bridge** (editor-prefill-store.ts, consumeEditorPrefill):
   - Advisor segment proposals push state via sessionStorage (hash history compat)
   - Segment conversion ("Convert to Live") deep-links with ?convert=live
   - Loads predicate from existing segment on edit

---

## 5. Segment Detail UI (src/pages/Segments/detail/)

### Main View (detail-view.tsx)
- **Header:** Editable title, action buttons (edit, delete, "Convert to Live" for manual)
- **Health Pill** (segment-health-pill.tsx): visual status (healthy|due|in_flight|wedged|serving_stale|degraded|broken)
- **Headline Stats:** uid_count, last_refreshed_at, size trend sparkline (7-day refresh log)

### Tabs
1. **Members** (members-tab.tsx):
   - Ranked profiles (from member_profiles_json snapshot) OR uid-only fallback
   - Pagination: offset cursor for profiles, keyset cursor for uids
   - Redaction: strips monetization/CS/VIP columns unless authenticated
   
2. **Insights** (insights-tab.tsx):
   - Saved Cube analyses pinned under this segment
   
3. **Monitor** (monitor-tab.tsx):
   - Card refresh status (ok|serving-last-good|error) per KPI
   - Live progress % if a refresh is in flight
   - Wedge detection + manual "unstick" button (admin-gated)
   
4. **Definition** (definition-tab.tsx):
   - Predicate tree view (read-only chips)
   - Funnel view (for funnel-built segments)
   - "Convert to Live" button (for manual segments)
   
5. **Activation** (activation route):
   - (Not detailed in this map; see segment-proposal-card.tsx for chat-driven creation)

---

## 6. Members Pull API (tokenless, ranked)

### Route: GET /api/segments/:id/members?cursor=&limit=1000
- **Auth:** none (tokenless by design; served over VPN)
- **Response:** { segment_id, game_id, cube, computed_at, total_count, rank_measure, columns, returned_count, truncated, members, next_cursor, [redacted_columns] }

### Member Sources (precedence)
1. **Ranked profiles** (segment.member_profiles_json): top-1000 by rank measure + preset member columns
   - Computed at refresh time (memberProfiles step of refresh cycle)
   - Offset cursor (numeric index into static snapshot)
2. **UID fallback** (segment.uid_list_json): dedup + sort, keyset cursor (uid > cursor)
3. **Manual segment lazy eval** (ensureManualMemberProfiles): compute on first pull for small manual cohorts

### Sensitive Column Redaction (lines 62-94)
- Strips if unauthenticated: billing_detail, cs_ticket_detail, vip, csat, sentiment, charged, promotion, lifetime_vnd/usd, etc.
- Announced in redacted_columns + redaction_reason

---

## 7. Chat Segment Proposal (segment-proposal-card.tsx)

### Three Actions
1. **Create:** POST /api/segments { name, type:'predicate', cube, game_id, predicate_tree, tags:['ai-generated'] }
2. **Open Editor:** route to /segments/new with EditorLocationState.advisorPrefill (tree + cube + name)
3. **Cancel:** dismiss without write

### Integration
- Chat emits segment_proposal SSE event → proposal card renders
- User edits name, visibility, then creates or opens editor for further refinement

---

## 8. Key Gaps & Rough Edges

### Manual Builder Limitations
- **No compound percentile UI:** can express "≥75th percentile" but NOT "≥75th percentile among payers" (the `over.filter` nesting)
- **Percentile inside OR:** tree accepts it (type-safe at server), but editor blocks save-back (translatability gate)
- **Derived date only on time dims:** no "user_created_at within last 30 days" as a top-level time-op; stored as inDateRange absolute [from, to] instead

### Segment Operations
- **No overlap/comparison:** can't visually compare segment Venn diagrams, membership deltas, or clustering
- **No membership history chart:** can see cohort size trend (sparkline) but not member churn/growth rate within a segment
- **No bulk predicate editor:** manual editing of JSON tree not exposed in UI (internal server queries only)
- **Limited percentile population scoping:** UI supports table.column + filter, but not complex population restrictions (e.g., "within last 90 days" as a constraint on the reference population)

### Refresh & Cache
- **Refresh latency not surfaced:** no "estimated time to refresh" or queue depth UI
- **Card-cache "serving-last-good" is silent:** status='ok' + error breadcrumb means the card is stale but reads green (the degraded state catches it, but the discrepancy is easy to miss)
- **Snapshot cadence separate from refresh cadence:** two independent schedulers (daily snapshot job vs. predicate refresh cron) — can desync if one fails

### Percentile Resolver
- **Two-pass resolver lives in POST /api/segments/resolve-cutoff:** requires user to explicitly trigger before save, OR the server resolves during refresh (save-back captures the literal cutoff value, not the percentile spec)
- **Absolute value drift:** a percentile saved at refresh time captures the cutoff at that moment; if data shifts, the literal value stays frozen unless re-resolved

### Account Scoping
- **Identity field assumed 1:1 per cube:** percentile identityMerge handles multi-row cases, but picker assumes single identity; jus_vn split_part case is manual configuration, not auto-detected

---

## File References (quick index)

### Server
- **Routes:** server/src/routes/segments.ts (CRUD, /resolve-cutoff:591, /members:657)
- **Data model:** server/src/db/migrations/001-init.sql, 048-segment-snapshot-log.sql, 046-segment-member-profiles.sql
- **Refresh:** server/src/jobs/refresh-segment.ts, refresh-queue.ts, cron-runner.ts
- **Snapshot:** server/src/lakehouse/segment-snapshot-writer.ts:112 (buildSegmentMembershipSql), jobs/snapshot-segment-membership.ts
- **Translator:** server/src/services/translator.ts (tree ↔ cube filters)
- **Predicate compiler:** server/src/services/predicate-to-sql.ts

### Frontend
- **Types:** src/types/segment-api.ts (Segment, PredicateNode, LeafOperator)
- **Editor:** src/pages/Segments/editor/editor-view.tsx, predicate-builder/{predicate-leaf.tsx, predicate-group.tsx, operators.ts, value-input.tsx}
- **Detail:** src/pages/Segments/detail/detail-view.tsx, tabs/{members-tab.tsx, monitor-tab.tsx, definition-tab.tsx}
- **Compiler:** src/pages/Segments/predicate-tree-to-cube-query.ts
- **Proposal:** src/pages/Chat/components/segment-proposal-card.tsx
- **API client:** src/api/segments-client.ts

---

**Last updated:** 2026-06-21 (GMT+7)
