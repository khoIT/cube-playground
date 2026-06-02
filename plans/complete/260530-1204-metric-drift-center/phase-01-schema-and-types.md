# Phase 01 — Schema & Types

## Context
- Type source of truth: `server/src/types/business-metric.ts` (Zod-first, FE re-imports).
- Migration runner: `server/src/db/sqlite.ts` (sorted files, `slice(currentVersion)`, `user_version = files.length`). Next file = `021-`.
- Mirror patterns: `009-anomalies.sql`, `016-business-metric-audit.sql`, `anomaly-state-store.ts`.

## Overview
- Priority: P1 (blocks everything).
- Status: pending.
- Add (a) a per-game applicability flag to `BusinessMetric.meta`, and (b) a SQLite table for the detector→product drift snapshot. No behaviour change yet.

## Data flow
- IN: nothing new at runtime; this phase only defines shapes consumed by phases 02–05.
- TRANSFORM: extend Zod schema → inferred TS type flows to server + FE; new table created on next `getDb()`.
- OUT: `BusinessMetricMeta.applicability` array; `metric_drift_snapshot` table.

## Requirements
### Functional
1. `BusinessMetricMeta` (currently `.passthrough()` with `game_id`, `trust_history`) gains:
   ```
   applicability?: Array<{ game: string; applicable: boolean; at: string (datetime); actor?: string; note?: string }>
   ```
   Append-only history-style list (latest entry per game wins), mirroring `trust_history`. Zod-validated.
2. New migration `021-metric-drift-snapshot.sql` creating `metric_drift_snapshot`.
   **Keyed by `(workspace_id, game, source)`** — this is what makes drift
   workspace-independent (switching workspace shows that workspace's own snapshot, never
   overwrites another's). Detector rows persist under `workspace_id='local'`,
   `source='detector'`; live page rows under the active workspace id, `source='live'`.
   ```
   id            INTEGER PK AUTOINCREMENT
   workspace_id  TEXT NOT NULL              -- active workspace id; detector writes 'local'
   game          TEXT NOT NULL
   metric_id     TEXT NOT NULL
   ref           TEXT NOT NULL              -- offending fully-qualified ref
   reason        TEXT NOT NULL CHECK(reason IN ('unparseable','cube-missing','member-missing'))
   source        TEXT NOT NULL CHECK(source IN ('detector','live')) DEFAULT 'detector'
   updated_at    TEXT NOT NULL
   UNIQUE(workspace_id, game, metric_id, ref, source)
   ```
   Index `metric_drift_snapshot_scope_idx ON (workspace_id, game, source)`.
   **v1.5 hook:** a future `last_seen_at TEXT` / `freshness_date TEXT` column is additive — no rename, no data migration. Note this in the SQL comment.

### Non-functional
- Migration idempotent (`CREATE TABLE IF NOT EXISTS`).
- Zod change must not break existing YAMLs (field is optional).

## Related code files
- Modify: `server/src/types/business-metric.ts` (add `applicability` to `BusinessMetricMetaSchema`; export `MetricApplicabilityEntry` type).
- Create: `server/src/db/migrations/021-metric-drift-snapshot.sql`.

## Implementation steps
1. In `business-metric.ts`, add `MetricApplicabilityEntrySchema` (game, applicable, at datetime, actor?, note?) and reference it as `applicability: z.array(...).optional()` inside `BusinessMetricMetaSchema`. Export inferred type.
2. Write `021-metric-drift-snapshot.sql` per schema above with the v1.5 comment.
3. `cd server && npm run typecheck` (or `tsc --noEmit`) — confirm no type breakage.
4. Boot once / run a server test so the migration applies; confirm `user_version` advances to 21.

## Todo
- [ ] Add `applicability` to `BusinessMetricMetaSchema` + exported type
- [ ] Create `021-metric-drift-snapshot.sql`
- [ ] typecheck passes
- [ ] migration applies cleanly (user_version → 21)

## Success criteria
- `BusinessMetricSchema.parse` accepts a YAML with `meta.applicability` and rejects malformed entries.
- Fresh DB reaches `user_version = 21`; existing dev DB applies only `021`.
- Table carries `workspace_id`; `UNIQUE(workspace_id, game, metric_id, ref, source)` and `source` enum `('detector','live')`.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Migration count drift if two branches both add `021` | M×M | Single migration this plan; rebase-check before merge. |
| `.passthrough()` lets a typo'd `applicability` shape slip through silently | L×M | Define explicit sub-schema; passthrough only affects *unknown* keys, known keys still validated. |

## Security
- No authz here; data shapes only. Applicability writes are gated in phase-03.

## Next
- Phase 02 consumes the table + the `applicability` field.
