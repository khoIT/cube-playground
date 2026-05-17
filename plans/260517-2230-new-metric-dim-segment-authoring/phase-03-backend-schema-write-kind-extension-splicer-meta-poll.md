---
phase: 3
title: "Backend schema-write kind extension splicer meta-poll"
status: completed
priority: P1
effort: "1d"
dependencies: [2]
---

## Implementation note

`measureName` → `entryName` "single-sweep rename" was **partially applied**:
backend (handler + validator + audit) now uses `entryName` exclusively. The 5
frontend call-sites (`NewMetricDialog`, `pending-writes`, `use-live-preview`,
`use-test-run`, `test-run-body`) still send the legacy `measureName` field —
the validator accepts both. This works because P4-P7 will rewrite those call-
sites anyway, so a churn-only rename now would be reverted twice. New code
(Phase 4+) MUST send `entryName` + `kind`.

# Phase 3: Backend schema-write kind extension splicer meta-poll

## Overview

Extend `/api/playground/schema/write` to accept a `kind` discriminator and splice the patch into the correct cube section. Single-sweep rename of `measureName` → `entryName` across all consumers (no alias). `.bak` becomes per-(entry, kind) so concurrent multi-kind writes can't clobber each other's rollback. `meta-poll` extends to inspect the right section per kind, preserving its throws-on-timeout contract.

**Red-team applied:** F-3, F-4, F-7, F-11.

## Requirements

- **Functional:**
  - Endpoint body: `{ cubeName, entryName, kind: 'measure'|'dimension'|'segment', yamlPatch }`. `kind` defaults to `'measure'` if omitted (HTTP back-compat only — no internal alias). `entryName` **fully replaces** `measureName` across all 5 frontend call-sites + WriteBody type + audit log in this phase (single sweep per red-team F-11).
  - `yaml-splice.ts` `splice(input, cubeName, entryName, kind, yamlPatch)` inserts under `cube.measures[]`, `cube.dimensions[]`, or `cube.segments[]`. Per-kind required-keys (red-team F-7):
    - measure: `[name, sql, type]` (existing).
    - dimension: `[name, type]` plus exactly one of `sql` or `case`.
    - segment: `[name, sql]`.
  - **Per-section duplicate scan (red-team F-7):** the dup-check at `yaml-splice.ts:106-111` becomes section-scoped. measure write scans `cube.measures[]`, dimension write scans `cube.dimensions[]`, segment write scans `cube.segments[]`. Cross-kind same name allowed (no rejection).
  - `meta-poll.ts` `waitForMember` parameterized by kind, polls `meta.cubes[].measures[]` / `.dimensions[]` / `.segments[]`. **Contract preserved (red-team F-3): `waitForMember` THROWS on timeout** (existing behavior at `meta-poll.ts:63,78,93`). Handler catch block at `schema-write-handler.ts:184-191` produces `warning: 'meta-not-acknowledged'`. Tests assert the throw, not a null return.
  - **Per-(entry, kind) `.bak` (red-team F-4):** filename scheme `<cube>.yml.<entryName>.<kind>.bak`. `writeBak(targetPath, entryName, kind, priorContent)` and `restoreBak(targetPath, entryName, kind)` updated. First-write-wins remains, scoped to the (entry, kind) tuple, so a fresh dim write's `.bak` and a subsequent measure write's `.bak` are independent files. DELETE flow restores the correct backup by (entry, kind).
  - **`PendingEntry` extended with `kind`** (`pending-writes.ts:23-26`) so cross-kind same-name entries don't collapse in the dedupe at `addPending`.
  - DELETE endpoint accepts `kind`; restores the matching per-kind backup.
- **Non-functional:**
  - HTTP back-compat: body without `kind` defaults to `'measure'` (legacy callers untouched).
  - Audit log uses `entryName` + `kind` fields consistently (no `measureName` field in new entries; old entries in `_audit.jsonl` remain for historical record).

## Architecture

```
vite-plugins/
├── schema-write-handler.ts     (modify — pass kind through)
├── schema-write-validator.ts   (modify — kind field validation)
├── schema-write-response.ts    (unchanged)
├── yaml-splice.ts              (modify — per-kind splice + per-kind required keys)
├── meta-poll.ts                (modify — section-aware wait)
└── schema-file-ops.ts          (unchanged)

src/QueryBuilderV2/NewMetric/
└── api.ts                      (modify — postSchemaWrite/deleteSchemaWrite accept kind)
```

## Related Code Files

- Modify: `vite-plugins/yaml-splice.ts` — kind param, three target sections, per-kind required keys, cross-section duplicate-name policy.
- Modify: `vite-plugins/schema-write-validator.ts` — `kind` field validation, `entryName` alias.
- Modify: `vite-plugins/schema-write-handler.ts` — propagate `kind` to splice + waitForMember + audit.
- Modify: `vite-plugins/meta-poll.ts` — `waitForMember(api, cube, name, { kind, ... })`.
- Modify: `src/QueryBuilderV2/NewMetric/api.ts` — body shape.
- Modify: `vite-plugins/__tests__/yaml-splice.test.ts` — extend cases.
- Read for context: existing `yaml-splice.ts`, `meta-poll.ts`, `mf_users.yml`.

## Implementation Steps (TDD — tests first)

1. **Write failing tests for `splice()` per kind** in `__tests__/yaml-splice.test.ts`:
   - `splice(input, cube, 'payer_tier', 'dimension', dimPatch)` inserts under `cube.dimensions[]`, preserves existing entries.
   - `splice(input, cube, 'whales', 'segment', segPatch)` inserts under `cube.segments[]`.
   - `splice(input, cube, 'sum_x', 'measure', mPatch)` unchanged from today.
   - Within-kind duplicate (e.g. another dim named `payer_tier`) → throws "already exists" with kind name.
   - **Cross-kind same name in BOTH directions (red-team F-7):**
     - `splice(input, cube, 'whales', 'segment')` succeeds when `cube.measures[]` already contains `{name: 'whales'}`.
     - `splice(input, cube, 'sum_x', 'measure')` succeeds when `cube.segments[]` already contains `{name: 'sum_x'}`.
   - **Per-kind required-keys (red-team F-7):**
     - Banding patch with `case:` and NO `sql:` for `kind='dimension'` → passes (legal banding).
     - Banding patch with neither `sql:` nor `case:` for `kind='dimension'` → throws.
     - Measure patch missing `type:` → throws (regression on existing required-keys).
   - `RESERVED_NAMES` set still rejects `dimensions`, `segments`, `measures` as entry names (any kind).
2. **Write failing tests for validator** `schema-write-validator.test.ts`:
   - Body without `kind` → defaults to `'measure'` (back-compat).
   - Body with `kind: 'dimension'` and `entryName` set → passes validation.
   - Invalid kind value → 400.
   - Missing `entryName` and `measureName` → 400.
3. **Write failing tests for `meta-poll`** `meta-poll.test.ts` (mock `/meta` response):
   - kind=measure waits for `measures[].name === ...` (regression).
   - kind=dimension waits for `dimensions[].name === ...`.
   - kind=segment waits for `segments[].name === ...`.
   - **Timeout THROWS per existing contract (red-team F-3):** lines 63, 78, 93 of `meta-poll.ts` all throw `Error('meta-poll timeout after ...')`. Test asserts throw, NOT null. Handler-level test (separate) asserts the handler's catch block returns `200 + warning: 'meta-not-acknowledged'`.
   - kind=dimension on cube whose `/meta` returns no `dimensions` key (cube has only measures) → poll falls through cleanly to timeout; does NOT throw `TypeError` on `undefined.some()`. Implementation: `(cube?.dimensions ?? []).some(...)`.
3a. **Write failing tests for per-(entry, kind) `.bak` (red-team F-4)** in `__tests__/schema-file-ops.test.ts`:
   - `writeBak(path, 'payer_tier', 'dimension', content)` creates `<path>.payer_tier.dimension.bak`.
   - `writeBak(path, 'payer_tier', 'dimension', second_content)` is a no-op (first-write-wins, scoped to (entry, kind)).
   - `writeBak(path, 'whales', 'segment', content)` creates a SEPARATE `<path>.whales.segment.bak` file even if `<path>.payer_tier.dimension.bak` exists.
   - `restoreBak(path, 'payer_tier', 'dimension')` restores only the matching backup; leaves the segment one intact.
   - Concurrent multi-kind write integration test: write dim → write segment → DELETE dim → segment YAML survives.
4. **Implement `yaml-splice.ts`** — refactor `splice()` to take `kind`, switch on target section. Lift duplicate-name detection into a helper scoped to the target section.
5. **Implement validator changes** — `kind` enum, `entryName`/`measureName` alias logic, per-kind required-keys.
6. **Implement handler updates** — pass `kind` to `splice()` and `waitForMember()`. Include `kind` in audit log entries.
7. **Implement `meta-poll.waitForMember`** signature change. Default `kind = 'measure'` for back-compat.
8. **Implement frontend `api.ts` + single-sweep rename (red-team F-11)** — `postSchemaWrite({ cubeName, entryName, kind, yamlPatch })` + `deleteSchemaWrite({ cubeName, entryName, kind })`. Update all 5 call-sites in one sweep, no alias on internal types:
   - `src/QueryBuilderV2/NewMetric/NewMetricDialog.tsx:131`
   - `src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/pending-writes.ts:89,104`
   - `src/QueryBuilderV2/NewMetric/hooks/use-live-preview.ts:113,126`
   - `src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/use-test-run.ts:130,135`
   - `src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/test-run-body.tsx:247,253`
   - HTTP-only alias: validator accepts `measureName` in body for legacy clients (logs deprecation), but the internal type and audit log use `entryName` exclusively. Remove the HTTP alias in a future plan once telemetry shows zero legacy callers.
9. **Hot-reload manual sanity check** — write a dim, write a segment, write a measure, all three appear in Cube `/meta` within the 15s budget. Document the manual run in success criteria.

## Success Criteria

- [ ] All splicer tests green (per-kind insertion + per-section duplicate scan + cross-kind same-name + reserved-name).
- [ ] All validator tests green.
- [ ] All meta-poll tests green (incl. throws-on-timeout + undefined-section guard).
- [ ] All per-(entry, kind) `.bak` tests green.
- [ ] **Single-sweep `entryName` rename complete:** all 5 frontend call-sites + audit log use `entryName`; no `measureName` reference in non-HTTP-shim code paths.
- [ ] DELETE flow restores correct per-(entry, kind) backup; segment write survives dim discard on same file.
- [ ] Audit log entries include `entryName` + `kind` fields.
- [ ] Measure-mode write path byte-identical when called via the renamed `entryName` shape (back-compat verified at HTTP level via legacy `measureName` body shim).
- [ ] Manual sanity: write `payer_tier_v2` (dim) + `vn_whales_v2` (segment) + `sum_ltv_test` (measure) against `mf_users.yml` — all three land in correct sections, hot-reload visible in `/meta`, each has its own `.bak`.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Splicer mutates the wrong section due to YAML key collision | Test covers ordering edge case where cube has both `measures` and `dimensions`. Locate target section by literal key name, not array index. |
| `js-yaml.dump` strips comments in `mf_users.yml` after splice | Known limitation already accepted in `yaml-splice.ts:13-17` (existing comment). Document as carried-over caveat in audit log. |
| Cross-kind same-name causes downstream confusion in Cube `/meta` lookup | `waitForMember` is scoped per kind (P3 change), so polling a dim named `whales` won't false-positive on a measure named `whales`. UI badges (P8) handle user-facing disambiguation. |
| Back-compat break — existing P2 wizard sends `measureName` not `entryName` | Validator accepts both, prefers `entryName`. Document in `api.ts` comment. Remove `measureName` alias in a follow-up sweep once all callers migrate. |
| Audit log size grows with `kind` field | Marginal (<10 chars per line). No mitigation needed. |

## TDD Test Inventory

| Test | What it locks in |
|---|---|
| `splice inserts dimension under cube.dimensions[]` | Section routing for dim |
| `splice inserts segment under cube.segments[]` | Section routing for segment |
| `splice rejects within-kind duplicate` | Per-kind uniqueness |
| `splice allows cross-kind same name` | Cross-kind policy |
| `validator defaults missing kind to measure` | Back-compat |
| `meta-poll waits in correct section per kind` | Polling correctness |
| `delete restores bak for all kinds` | Rollback parity |
| `existing measure-mode behavior unchanged` | Regression gate |
