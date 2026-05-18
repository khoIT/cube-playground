# Code Review — GDS Cube Frontend

**Date:** 2026-05-15
**Reviewer:** code-reviewer
**Scope:** `src/` + root config (`package.json`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`)
**Build/Test status:** Build green, TS clean, 10/10 tests pass

## Rating: **Approve with notes**

Solid net-new app. Clean separation, no playground/cloud/vizard contamination, race conditions mostly handled. Two real bugs (URL double-decode, missing seq counter in `use-cube-sql`) plus a few medium-impact issues worth fixing before broad rollout, but nothing that blocks landing.

---

## Top Issues

### 1. URL query double-decode corrupts/breaks filter values containing `%` — **HIGH**
**File:** `src/pages/playground/playground-page.tsx:11-18`
**Origin:** `src/pages/data-model/cube-detail.tsx:47` encodes once.

`URLSearchParams.get('query')` already returns the **decoded** value. `parseQueryParam` then calls `decodeURIComponent` a second time. Two failure modes verified empirically:

- Value `"100%"` → `decodeURIComponent` throws `URI malformed` → caught → query silently lost.
- Value `"path%2Fto"` (literal percent-encoded substring) → silently mutated to `"path/to"`.

Same path also affects the URL-sync effect in `playground-page.tsx:34-39`: it re-encodes on every state change, so the round-trip works only for queries that survive both single-decode and JSON parsing.

**Fix:** Drop the `decodeURIComponent` in `parseQueryParam`. Pair: keep `JSON.stringify` but skip `encodeURIComponent` when writing to `URLSearchParams.set` (it encodes internally). Or use `URLSearchParams` end-to-end and avoid manual encode/decode.

### 2. `use-cube-sql` has no seq counter / cancellation — **MEDIUM**
**File:** `src/hooks/use-cube-sql.ts:11-33`, consumed by `src/pages/playground/sql-preview.tsx:35-38`

`fetchSql` re-fires on every `query` change while SQL tab is active. If query A's request resolves **after** query B's, state shows SQL for A. `use-cube-query.ts` does this correctly (seq counter + unmount bump); copy the pattern here.

**Fix:** Mirror the `seq` ref idiom from `use-cube-query.ts:23-50`. Bump on unmount too.

### 3. `setTimeout(onClose, 400)` after token validate is unguarded — **LOW**
**File:** `src/components/security/security-context-modal.tsx:80`

If the modal unmounts (close button, route change) inside the 400ms window then re-opens, `onClose` still fires on the now-open modal. Cosmetic but easy: store the timer id in a ref and `clearTimeout` in cleanup + on each new validate.

### 4. `CubeProvider` value object is not memoised — **LOW**
**File:** `src/context/cube-context.tsx:71-80`

`value` is a fresh object on every render of `CubeProvider`, so every context consumer re-renders whenever the provider re-renders. Provider's local state only flips for token/ready/error so blast radius is small, but standard fix is cheap:

```tsx
const value = useMemo<CubeContextValue>(() => ({...}), [resolvedApiUrl, token, cubeApi, isReady, lastError, setToken, validate]);
```

### 5. Filter operator swap drops binary `values` when going binary→binary with different shape — **LOW**
**File:** `src/pages/playground/filter-list.tsx:97-110`

Unary→binary path: uses `(filter as BinaryFilter).values ?? ['']` — safe.
Binary→binary path: spreads `...filter` (line 105-108 substitutes member-only path is fine). Actual issue: when previous filter was unary, `values` is `undefined`; code handles via fallback. **Not actually a bug** — verified. Mentioned for completeness.

Real minor: `e.target.value.split(',')` (line 127) gives no escape syntax for commas inside a value. Acceptable for v0.

---

## File-size scan
All files **under 200 LOC**. Largest:

| LOC | File |
|-----|------|
| 192 | `src/pages/playground/member-picker.tsx` |
| 178 | `src/pages/data-model/cube-detail.tsx` |
| 161 | `src/hooks/use-query-state.ts` |
| 147 | `src/pages/playground/filter-list.tsx` |
| 139 | `src/components/security/security-context-modal.tsx` |

No action required.

---

## Drop-list compliance
| Forbidden | Result |
|-----------|--------|
| Imports from `cloud/`, `live-preview/`, `vizard/`, `rollup-designer/`, `frontend-integrations/` | **Clean** (grep returned nothing) |
| `/playground/*` Cube REST endpoints | **Clean** (only the React route `/playground` used; no `/cubejs-api/playground/*` calls) |
| `playgroundOptions` / `cubejs-playground` symbols | **Clean** |
| Direct `fetch` / `axios` calls bypassing `@cubejs-client/core` | **Clean** |
| `dangerouslySetInnerHTML` / `.innerHTML` | **Clean** |
| `console.log` leakage of tokens | **Clean** (only `error-boundary.tsx:20` logs the Error object — no token) |

---

## Additional observations

### Security
- JWT stored in `localStorage` (`src/lib/cube-api.ts:21`) — explicit playground threat model, no XSS sinks present. Acceptable. Document for ops.
- Token never logged or echoed into URLs.
- Token rendered into DOM only as `<textarea value=...>` (React-escaped) — safe.
- `setStoredToken('')` correctly removes the key rather than storing empty string.

### Correctness
- `use-cube-query.ts` race handling solid (seq counter + unmount bump).
- `use-meta.ts` cancellation flag correctly guards both `then` and `catch`.
- `CubeProvider` first-mount validate gated by `didInit` ref — survives StrictMode double-mount.
- `playground-page.tsx:30` `useMemo(..., [])` for initial query is intentional one-shot capture; combined with the eslint-disabled effect on line 39, the URL becomes a derived view of state (state is source of truth). Sound, but the `useMemo` deps array should also carry the `// eslint-disable-line react-hooks/exhaustive-deps` comment to match the convention used on line 39 (or just inline the parse in `useState` initializer).
- `query-builder-sidebar.tsx:51` `Number(e.target.value) || 0` bypasses `min=1` for empty input. Send `Math.max(1, n)` if Cube treats `limit:0` poorly.
- `chart-preview.tsx:42` calls `pickXKey([{key:'x'}])` which always returns `'x'`. Dead indirection — inline as `const xKey = 'x'` or use the actual `columns` from `resultSet.tableColumns()`. The chart works because Cube's `chartPivot` keys axis as `'x'`, but the helper masks the assumption.
- `results-table.tsx:30` empty-result branch is correct; chart branch (`chart-preview.tsx:34`) also handles empty.

### Types / lint
- Two `any` in `use-meta.ts` (lines 27, 65) — pragmatic, well-bounded. Could replace with `unknown` + narrowing but not load-bearing.
- Casts in `cube-detail.tsx:51,56` for `joins` / `preAggregations` — accepted given Cube `Meta` type omits these; structural cast with optional access is safe.

### React patterns
- Context value not memoised (Issue #4 above).
- `playground-page.tsx:34-39` exhaustive-deps suppression is sound (URL is derived view, state is source of truth). Verified.
- `sql-preview.tsx:35-38` deps include `query` (whole object) — refires on every state mutation. Fine for now; with seq counter in #2 it's safe.

### Tests
- 10/10 passing. Coverage focused on `use-query-state` and `cube-api` env handling. Missing: hook tests for `use-cube-query` cancellation, `use-cube-sql` race (currently uncovered → see #2). Not blocking for v0.

---

## Recommended Actions

1. **Fix #1** (drop the second `decodeURIComponent` in `playground-page.tsx:14`, and remove the redundant `encodeURIComponent` from `cube-detail.tsx:47` since React Router/`URLSearchParams` handle URL encoding).
2. **Fix #2** (port `seq` counter from `use-cube-query` into `use-cube-sql`).
3. **Wrap `CubeProvider` value in `useMemo`** (#4).
4. **Clear the `setTimeout`** in security modal (#3).
5. Optional: inline `xKey = 'x'` in `chart-preview.tsx`; clamp `setLimit` to ≥1.

---

## Unresolved Questions

- Is `localStorage` storage of the JWT acceptable to security/compliance for this internal tool, or should we move to `sessionStorage` / in-memory only? (Not blocking but worth a one-line confirmation in the README.)
- The double-decode of the `query` URL param (Issue #1) raises a sister question: do we want a stable, shareable URL representation? If yes, consider base64url-encoding the JSON to dodge nested-percent issues entirely.

---

**Status:** DONE
**Summary:** Net-new GDS Cube frontend approved with notes. Drop-list compliance clean, file sizes all under 200 LOC, builds/tests green. Two real bugs to address before broad rollout: URL query double-decode (HIGH) and missing race-counter in `use-cube-sql` (MEDIUM); three low-severity polish items.
