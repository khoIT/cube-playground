# Brainstorm — Define-Metric Wizard POC

**Date:** 2026-05-16
**Status:** Design approved, awaiting `/ck:plan` invocation
**Approach:** A — Wizard + existing-joins discovery
**Write target:** dev-only POST endpoint + JSONL audit log
**Cross-cube policy:** block save when no join path exists

---

## Problem

Cube schemas live on a remote Cube server. Today, adding a new measure means editing YAML in an IDE, redeploying, and waiting for `/meta` to refresh. Non-engineer authors (PMs, analysts) cannot self-serve. Goal: a single POC flow inside the Playground that lets a user define a new measure from existing cube members, write valid YAML to the dev Cube's `model/` dir, and see the member appear in the sidebar within ~1s via hot-reload.

Out of scope for v1: authoring new cube-to-cube joins, multi-hop join inference, prod write path, role-based authoring.

---

## Acceptance criteria

1. New top-bar CTA **"✱ New metric"** sits to the right of "API Settings" in the app header. Clickable from any route.
2. Clicking opens a fullscreen `Dialog` with a 5-section wizard: Source → Operation → Of → Filter → Identity, plus a live YAML + dry-run-SQL preview panel.
3. Operation set: `sum`, `count`, `countDistinct`, `avg`, `min`, `max`, `ratio`.
4. Source picker lists every cube from `meta.cubes`. After a cube is picked, the **Of** picker lists:
   - dimensions and measures of the source cube,
   - dimensions/measures of cubes reachable via 1-hop existing joins (read from `cube.joins[]` in `meta`),
   - format: `users.email (via orders.user_id = users.id)`.
5. If user picks an "Of" member from a cube with no join path to the source → "Define" button disabled with inline message: *"orders and products are not joined yet. Define the join in your schema repo first."* No auto-join inference.
6. Live YAML preview is read-only, regenerates on every field change, formatted with 2-space indent.
7. **Validate** button calls Cube `/sql` dry-run with a synthetic query that exercises the new member, surfaces compile errors inline.
8. **Save to schema** POSTs `{cubeName, measureName, yaml}` to dev-only endpoint, which:
   - appends the `measures:` entry to `model/<cube>.yml` (creates `measures:` section if missing),
   - appends one row to `model/_audit.jsonl` (timestamp, user-agent, cube, name, yaml),
   - returns 200 only if Cube's hot-reloader successfully picks up the change (poll `/meta` for the new name, 5s timeout).
9. Frontend re-fetches `/meta` on success and toasts *"`active_users` added to `orders`"*. Wizard closes.
10. Endpoint refuses to start when `NODE_ENV !== 'development'`.

---

## State-of-the-art references (what informs the UI shape)

- **Cube Cloud Data Modeler** — closest match. Pick cube → pick aggregation → pick column → name → save. Hot-reloads. This POC mirrors it minus the visual joins canvas.
- **dbt MetricFlow Studio** — same wizard pattern; "join via existing relationships" is the discoverability principle we're stealing.
- **Looker LookML editor** — Monaco-based, considered but rejected as Approach C: too much surface for a POC.
- **Hex / Sigma "calculated columns"** — formula-bar style. Rejected because Cube measures aren't formula-string columns, they're typed YAML.

The unifying principle across A-tier tools: **never make the user type YAML, never make the user type SQL join clauses, always show the SQL the system will generate.**

---

## Architecture

### Frontend pieces (new)

| File | Role |
|---|---|
| `src/QueryBuilderV2/NewMetric/NewMetricButton.tsx` | Header CTA. Renders next to API Settings, opens dialog. |
| `src/QueryBuilderV2/NewMetric/NewMetricDialog.tsx` | Fullscreen `Dialog` shell, 5-section wizard layout. |
| `src/QueryBuilderV2/NewMetric/sections/SourceSection.tsx` | Cube picker + reachable-joins display. |
| `src/QueryBuilderV2/NewMetric/sections/OperationSection.tsx` | Radio group, 7 ops. |
| `src/QueryBuilderV2/NewMetric/sections/OfSection.tsx` | Member picker, filtered by source + join reachability. |
| `src/QueryBuilderV2/NewMetric/sections/FilterSection.tsx` | Reuses existing `FilterMember` for one optional filter row. |
| `src/QueryBuilderV2/NewMetric/sections/IdentitySection.tsx` | Name (snake_case validated), title, description, format. |
| `src/QueryBuilderV2/NewMetric/preview/YamlPreview.tsx` | Read-only YAML with PrismCode. |
| `src/QueryBuilderV2/NewMetric/preview/DryRunSqlPreview.tsx` | Calls `/sql` on Validate, renders compiled SQL or error. |
| `src/QueryBuilderV2/NewMetric/hooks/use-reachable-members.ts` | Builds member list from cube + 1-hop joins via `meta`. |
| `src/QueryBuilderV2/NewMetric/hooks/use-metric-yaml.ts` | State → YAML string, single source of truth. |
| `src/QueryBuilderV2/NewMetric/api.ts` | Wraps `POST /api/playground/schema/write`. |

### Backend piece (new)

Single dev-only Vite middleware mounted in `vite.config.ts` for `/api/playground/schema/write`:
- Refuses if `process.env.NODE_ENV !== 'development'`.
- Resolves `cubeName` → `<CUBE_MODEL_DIR>/<cubeName>.yml` (env-configured root).
- Parses existing YAML with `yaml` package, splices the new `measures:` entry, writes back with stable ordering.
- Appends `{ts, ua, cubeName, measureName, yamlPatch}` to `<CUBE_MODEL_DIR>/_audit.jsonl`.
- Polls `<cube-api>/meta` until the new member is present (max 5s, 200ms interval) → 200 with new meta payload; on timeout → 504 with rollback (restore prior YAML).
- Single rejection list of disallowed names: cube reserved keywords + already-existing members on that cube.

### Wizard state shape

```ts
type NewMetricDraft = {
  sourceCube: string | null;
  operation: 'sum' | 'count' | 'countDistinct' | 'avg' | 'min' | 'max' | 'ratio';
  ofMember: string | null;            // e.g. "users.id"
  ofMemberB: string | null;           // only for ratio
  filter: BinaryFilter | UnaryFilter | null;
  name: string;                       // snake_case
  title: string;
  description: string;
  format: 'number' | 'currency' | 'percent';
};
```

### YAML generation rules

- Output is appended to `model/<sourceCube>.yml` under the `measures:` key.
- `sql:` is generated, not authored:
  - same-cube member → `"{<sourceCube>}.<col>"`
  - cross-cube via join → `"{<remoteCube>}.<col>"` (Cube resolves through the existing join)
  - ratio → `"{<sourceCube>}.<a>"` + `divides:` reference (Cube has first-class ratio support)
- Reserved Cube keys we don't touch: `joins:`, `dimensions:`, `segments:`, `pre_aggregations:`. We only ever append to `measures:`.

### Hot-reload contract

We trust Cube's filewatcher. The 5s `/meta` poll is the only fitness signal — if a new member doesn't appear, we treat the write as failed and roll back.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| User picks two cubes with no join path | Frontend filters Of-list to only reachable members; Save button disabled with explanatory copy. No SQL join authoring. |
| YAML write corrupts file (partial write, encoding) | Use `yaml` package round-trip, write to `<file>.tmp` then `fs.rename`. Rollback on hot-reload timeout. |
| Two users hit Save simultaneously | Audit log + file mtime check before write; reject if mtime changed since last read. Toast "Cube file changed externally — reopen the wizard." |
| Metric name collides with existing member | Pre-validate against `meta.cubes[sourceCube].measures + .dimensions`. Inline error in Identity section. |
| Cube hot-reload fails silently in prod | Endpoint is dev-only at process start; nothing to ship. |
| Free-text description is XSS vector when re-rendered | YAML preview is plain text via PrismCode; sidebar renders via existing escape paths. No new sink. |
| User authors a syntactically valid but semantically wrong measure | Validate button surfaces Cube's compile error before Save. If Validate is skipped, Save still hits Cube — broken measure is caught at hot-reload poll. |
| ratio operation with cross-cube members | Phase 2. v1 ratio requires both operands on the source cube. |

---

## Success metrics

- Time from "I have an idea for a metric" → "it shows in the sidebar" < 30s for a single-cube countDistinct.
- 0 broken YAML files after 20 successive saves on a clean repo.
- Audit log captures every save with cube + measure name.
- Wizard works against the existing `meta.cubes` shape with no schema changes to the frontend's meta consumer.

---

## What's intentionally NOT in v1

- Authoring new joins (separate "Define join" flow, Phase 2).
- Editing or deleting existing measures (Phase 2).
- Cross-cube ratio.
- Multi-hop join inference.
- Prod write path (needs auth, RBAC, PR workflow — Phase 3).
- View authoring.
- Measure-level pre-aggregations.

---

## Next steps

1. Invoke `/ck:plan` with this report as the source.
2. Plan should produce ≥4 phases: backend write endpoint + audit, wizard scaffolding + state, reachable-members hook + Of-picker, YAML generator + Validate/Save wiring.
3. Each phase ≤200 lines per file per the codebase's modularization rule.

---

## Open questions

- Snake_case for measure name vs the user's existing naming convention (some cubes use camelCase) — should we infer the convention from peer measures on the source cube? **Default for plan:** infer from peer measures, fall back to snake_case.
- Where does `<CUBE_MODEL_DIR>` get configured — `.env.local` or `vite.config.ts`? **Default for plan:** `VITE_CUBE_MODEL_DIR` in `.env.local`.
- Should the CTA also appear inside the QueryBuilder's Measures pill row (contextual entry point) in addition to the header? **Not in v1 unless user wants both.**
