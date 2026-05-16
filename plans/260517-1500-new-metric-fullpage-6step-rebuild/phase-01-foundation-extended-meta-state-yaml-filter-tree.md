---
phase: 1
title: "Foundation: state v2, YAML emitter v2, filter-tree, meta bootstrap, server hardening"
status: pending
priority: P0
effort: "1.5d"
dependencies: []
---

# Phase 1: Foundation state yaml filter-tree meta-bootstrap server-hardening

## Overview

Library + server hardening phase. No UI. Ships the pure modules and state shape every subsequent phase depends on:

- AND/OR filter-tree (types + builders + flatten-to-sql + validate) — TDD.
- YAML emitter v2 — filter-tree → single `sql:` fragment, `meta.grain`, `meta.visibility`. **No custom-sql operation per red-team finding #24.**
- Draft v2 state — extended fields + `localStorage` persistence + `beforeunload`/`visibilitychange` flush + multi-tab disable via `BroadcastChannel` + tabId-scoped key.
- Meta bootstrap hook (`useNewMetricMeta`) modelled on `src/pages/Catalog/use-catalog-meta.ts` — `useAppContext` does NOT carry `meta`/`cubejsApi`; the route needs its own bootstrap (red-team finding #5).
- Defensive type changes — `OPERATION_TYPE` becomes `Partial<Record<Operation, string>>` so P3's `Operation` extension doesn't break v1 emitter typecheck (red-team finding #20).
- Server origin allowlist on `schema-write-middleware.ts` (red-team finding #13); `_audit.jsonl` → `.gitignore` (red-team finding #18).
- Cube probe — enumerate which ballistar_vn cubes have a `count` measure (red-team finding #14).

**Red-team finding #2:** the `cubeApi.meta() → extended=true` flip is **already done** at `query-builder.ts:339-379` via direct fetch (SDK doesn't accept the flag — see comment :46-49). **No flip step in this phase.**

## Requirements

**Functional:**
- Filter-tree module: types, builders, flattener to SQL fragment, validators. Value-quoting is type-aware: numbers raw, strings `value.replace(/'/g, "''")` then single-quoted, IN lists parenthesised, control bytes (`\x00`–`\x1f`) + `\r\n` rejected, unknown column type throws.
- YAML emitter v2 accepts new draft shape; emits filter-tree as a single `sql:` entry under measure `filters: [...]`. Emits `meta.grain` + `meta.visibility`. **No `operation === 'custom'` branch.**
- `OPERATION_TYPE` map relaxed to `Partial<Record<Operation, string>>` so adding `'median' | 'percentile'` in P3 doesn't TS-fail the v1 emitter still resident until P8.
- Draft v2 type covers all 6-step fields (see brainstorm). Persists to `localStorage` key `gds-cube:new-metric-draft-v2:${tabId}` where `tabId` lives in `sessionStorage`. Debounced 200 ms write + synchronous flush on `beforeunload` + `visibilitychange === 'hidden'`. Restores on page load.
- `BroadcastChannel('new-metric')` broadcasts `editing` events; another open wizard tab sees the event and disables its own submit w/ "Another tab is editing this draft" banner.
- `validate(draft, { reachableNames })` — **`reachableNames` becomes required**, not optional. Hydration sanitizer drops any `ofMember` / `ofMemberB` / filter-tree leaf `column` absent from current `meta`.
- `useNewMetricMeta()` hook — fetches `/cubejs-api/v1/meta?extended=true` directly (mirrors `use-catalog-meta.ts`), returns `{ meta, cubejsApi, refreshMeta, loading, error }`. `cubejsApi` instantiated from `useAppContext().apiUrl + token`.
- All exports covered by Vitest tests before implementation lands.
- **Server-side:** `vite-plugins/schema-write-middleware.ts` adds origin allowlist (`http://localhost:3000`, `http://localhost:5173`, `http://127.0.0.1:*` — read from env if needed). Reject any request whose `req.headers.origin` is not in the list.
- **Repo:** add `_audit.jsonl` to `.gitignore` at repo root and at `metrics-catalogue/cube/model/.gitignore` if separate.

**Non-functional:**
- Each module file < 200 LOC.
- Filter-tree flattener pure (no side-effects), works on Vitest in node env.
- localStorage writes exception-safe (private mode / quota exceeded → log + one-time antd `notification.warning` + continue with in-memory state).
- All draft fields rendered into previews/YAML go through React's default text-node escaping — **no `dangerouslySetInnerHTML` in any wizard surface**. Vitest unit test asserts XSS payload (`<script>alert(1)</script>` in customSql-replacement field — e.g. `description`) renders as literal text.

## Architecture

```
src/QueryBuilderV2/NewMetric/
├── filter-tree/                            (NEW)
│   ├── types.ts                            FilterLeaf | FilterGroup | FilterNode
│   ├── builders.ts                         emptyTree, addLeaf, removeNode, setGroupOp, …
│   ├── flatten-to-sql.ts                   flattenToSql(node, columnTypes) → string
│   ├── validate.ts                         validateTree(node, eligibleColumns) → string[]
│   ├── index.ts                            re-exports
│   └── __tests__/
│       ├── flatten-to-sql.test.ts          (property tests for quoting)
│       ├── builders.test.ts
│       └── validate.test.ts
├── hooks/
│   ├── use-new-metric-draft.ts             EXTEND — v2 fields + localStorage + BroadcastChannel + beforeunload flush + mandatory reachability
│   ├── use-new-metric-meta.ts              NEW — meta bootstrap (mirrors use-catalog-meta.ts)
│   └── __tests__/
│       ├── use-new-metric-draft.test.ts    EXTEND
│       └── use-new-metric-meta.test.ts     NEW
└── yaml/
    ├── generate-measure-yaml.ts            EXTEND — filter-tree + meta.grain + meta.visibility (NO custom-sql)
    └── __tests__/
        └── generate-measure-yaml.test.ts   EXTEND
```

Server hardening:
```
vite-plugins/
├── schema-write-middleware.ts              MODIFY — add origin allowlist gate before validateWriteBody
└── (.gitignore at repo root)               ADD `_audit.jsonl` entry
```

## Related Code Files

- **Modify:** `src/QueryBuilderV2/NewMetric/hooks/use-new-metric-draft.ts` (extend state + persistence + reachability mandatory)
- **Modify:** `src/QueryBuilderV2/NewMetric/yaml/generate-measure-yaml.ts` (filter-tree, meta, OPERATION_TYPE → Partial)
- **Modify:** `src/QueryBuilderV2/NewMetric/types.ts` (add `Grain`, `Visibility`, expanded `Format`; `Operation` stays unchanged this phase — extension lands in P3)
- **Modify:** `vite-plugins/schema-write-middleware.ts` (origin allowlist)
- **Modify:** `.gitignore` (`_audit.jsonl`)
- **Create:** `src/QueryBuilderV2/NewMetric/filter-tree/*` (5 files)
- **Create:** `src/QueryBuilderV2/NewMetric/filter-tree/__tests__/*.test.ts` (3 files)
- **Create:** `src/QueryBuilderV2/NewMetric/hooks/use-new-metric-meta.ts`
- **Create:** `src/QueryBuilderV2/NewMetric/hooks/__tests__/use-new-metric-meta.test.ts`
- **Modify:** `src/QueryBuilderV2/NewMetric/hooks/__tests__/use-new-metric-draft.test.ts`
- **Modify:** `src/QueryBuilderV2/NewMetric/yaml/__tests__/generate-measure-yaml.test.ts`

## Implementation Steps (TDD)

1. **Probe** — manual `curl ${apiUrl}/cubejs-api/v1/meta?extended=true -H "Authorization: <token>"` to confirm payload shape. Note: `joins[]`, `connectedComponent`, `preAggregations` presence. **Also enumerate cubes with a defined `count` measure** in `ballistar_vn` — list which cubes have/lack it; P4/P5 query strategy depends on this (red-team #14).
2. **Write tests first** for filter-tree:
   - `flatten-to-sql.test.ts` — value-quoting: `country = 'O''Brien'` (escaped apostrophe), numeric `>` raw, IN list parenthesised, nested AND/OR parenthesised, control byte rejected, CR/LF rejected, unknown column type throws. Property test w/ `fc.string()` round-tripping through `flatten → js-yaml.dump → js-yaml.load → reparse leaf`.
   - `builders.test.ts` — `emptyTree()`, `addLeaf(tree, parentPath, leaf)`, `removeNode(tree, path)`, `setGroupOp(tree, path, 'OR')`. Deep-equal round-trip.
   - `validate.test.ts` — orphan leaves, empty groups (warning), value-type mismatch, references to non-eligible columns.
3. **Implement** `filter-tree/*` until tests pass.
4. **Write tests first** for YAML emitter v2 extensions:
   - Single AND tree → single `sql:` entry in `filters`.
   - Nested AND/OR tree → parenthesised single `sql:` entry.
   - `meta.grain = 'daily'` + `meta.visibility = 'team'` appear under `meta:`.
   - **No `operation === 'custom'` test case** — operation dropped.
   - `OPERATION_TYPE` typed as `Partial<Record<Operation, string>>` — adding a key not in the map returns `undefined` cleanly.
5. **Implement** emitter extensions until tests pass.
6. **Write tests first** for draft v2:
   - Default shape matches `NewMetricDraftV2` (brainstorm § State shape, minus `customSql`).
   - `setField` for every new field works.
   - localStorage save/load round-trips a full draft (key includes `tabId`).
   - `tabId` derived from `sessionStorage`; persists across reloads of same tab.
   - Quota-exceeded path falls back gracefully + surfaces one-time notification.
   - `beforeunload` + `visibilitychange === 'hidden'` flush pending writes synchronously.
   - `BroadcastChannel('new-metric')` — when another tab broadcasts `editing`, this tab's draft sets `otherTabEditing: true`.
   - **Hydration sanitizer** — given a stored draft w/ `ofMember: 'finance_payroll.salary'` and current `meta` lacking that cube, hydrate-then-validate resets `ofMember` to `null`.
   - Mandatory `reachableNames` parameter to `validate()` — passing `undefined` is a TS error.
   - XSS test — render `description: '<script>alert(1)</script>'` through a stub of the YAML preview; assert DOM contains literal `<script>`, no element.
7. **Implement** draft v2 + persistence + BroadcastChannel + hydration sanitizer until tests pass. Use `setTimeout` ref for debounce (no lodash).
8. **Write tests first** for `useNewMetricMeta`:
   - Mock `fetch('/cubejs-api/v1/meta?extended=true')` to return a known payload.
   - Returns `{ meta, cubejsApi, refreshMeta, loading, error }`.
   - `cubejsApi.load` is a real `CubejsApi` instance constructed from `apiUrl + token` via `@cubejs-client/core`.
   - `refreshMeta` re-fetches and updates `meta`.
9. **Implement** `useNewMetricMeta` mirroring `src/pages/Catalog/use-catalog-meta.ts`.
10. **Modify `vite-plugins/schema-write-middleware.ts`** — add origin allowlist:
    ```ts
    const ALLOWED_ORIGINS = (process.env.SCHEMA_WRITE_ALLOWED_ORIGINS ?? 'http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173').split(',');
    if (req.headers.origin && !ALLOWED_ORIGINS.includes(req.headers.origin)) {
      return jsonError(res, 403, 'origin-not-allowed');
    }
    ```
11. **Add `_audit.jsonl` to `.gitignore`** at repo root.
12. Run `npm run typecheck` + `npm run test`. Commit.

## Success Criteria

- [ ] Cube probe (step 1) documents which ballistar_vn cubes have a `count` measure; surfaced in plan as `### Cube Probe Results`.
- [ ] `src/QueryBuilderV2/NewMetric/filter-tree/` exports `FilterNode`, `flattenToSql`, builders, validator. All test cases above green incl. property test.
- [ ] `generate-measure-yaml` handles filter-tree, `meta.grain`, `meta.visibility`. No custom-sql branch present.
- [ ] `OPERATION_TYPE` is `Partial<Record<Operation, string>>`; adding `'median'` key in P3 is valid + needs no extra code in v1 emitter.
- [ ] `use-new-metric-draft` covers full v2 shape; localStorage round-trip works under `gds-cube:new-metric-draft-v2:<tabId>` key; quota-exceeded does not crash; `beforeunload`/`visibilitychange` flush proven by test; `BroadcastChannel` cross-tab test green.
- [ ] `validate()` requires `reachableNames`; hydration drops out-of-meta members.
- [ ] `useNewMetricMeta` returns working `meta` + `cubejsApi`; tested.
- [ ] `vite-plugins/schema-write-middleware.ts` rejects requests with `origin` not in allowlist (manual curl test from `evil.local`).
- [ ] `.gitignore` includes `_audit.jsonl`.
- [ ] No `dangerouslySetInnerHTML` in any new file (grep clean); XSS test asserts safe rendering.
- [ ] `npm run typecheck` + `npm run test` green; no existing tests broken; v1 dialog still compiles (`Partial<Record<Operation>>` shim).
- [ ] No UI changes visible to user.

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Cube probe reveals some cubes lack `count` measure → P4/P5 fallback strategy must adapt | Step 1 surfaces probe results in plan; P4/P5 plans gate on per-cube count availability + explicit empty-state for cubes without count. |
| `flattenToSql` value-escape misses a vector | Property-based tests w/ `fc.string()` edge values + explicit cases for `O'Brien`, NULL bytes, unicode RTL, CR/LF. Reject unknown column types. |
| localStorage corruption / format drift across versions | Version-stamp the stored object (`{ version: 2, draft }`); on mismatch, discard silently and start fresh. |
| Tab-scoped key + BroadcastChannel adds complexity vs single key | Worth it: avoids cross-tab clobber discovered in red-team #19. Test the cross-tab path explicitly. |
| Existing v1 draft consumers break on type extension | `Partial<Record<Operation>>` change + keep v1 fields as superset; run existing tests; v1 file deletion in P8 cleans up. |
| Origin allowlist breaks legitimate dev setups (non-localhost ports) | Env override `SCHEMA_WRITE_ALLOWED_ORIGINS=...`; document in CLAUDE.md or README. |
| Audit log retroactively contains historical raw YAML in git history | Step 11 only prevents future tracking. If `_audit.jsonl` is already in git, separate cleanup commit `git rm --cached _audit.jsonl` is required — document but do not block P1. |
| Hydration sanitizer drops user's pre-meta-refresh draft too aggressively | Sanitizer logs (console.warn) what it dropped; user notification "Some draft fields no longer match the schema and were cleared". |
