---
phase: 1
title: "Backend Write Endpoint + Audit"
status: completed
priority: P1
effort: "0.5d"
dependencies: []
---

# Phase 1: Backend Write Endpoint + Audit

## Context Links

- Brainstorm: [`plans/reports/brainstorm-260516-1526-define-metric-wizard.md`](../reports/brainstorm-260516-1526-define-metric-wizard.md) §Architecture/Backend, §Risks.
- Existing Vite config: `vite.config.ts` (proxy block + plugins).

## Overview

Dev-only Vite middleware `POST /api/playground/schema/write` that appends a `measures:` entry to `model/<cubeName>.yml`, audits the write, and confirms the change via a Cube `/meta` poll. Refuses to start when `process.env.NODE_ENV !== 'development'`.

## Key Insights

- Hot-reload is owned by Cube — we trust its filewatcher; the only fitness signal we have is whether the new measure appears in `/meta`.
- Atomicity comes from `write-tmp → rename` plus rollback on `/meta` timeout.
- mtime guard catches concurrent edits in a clean repo without needing a lock service.

## Requirements

**Functional**
- Accept `POST` with body `{ cubeName: string, measureName: string, yamlPatch: string }`.
- Validate `cubeName` and `measureName` shape; reject Cube-reserved keywords + collisions with existing members on the cube.
- Resolve target file: `<VITE_CUBE_MODEL_DIR>/<cubeName>.yml` (or `.yaml`).
- Read file → parse with `js-yaml` → splice into `measures:` (create section if missing) → dump with stable ordering → write `<file>.tmp` → `fs.rename`.
- mtime check: read mtime before parse; if mtime changed between read and rename, abort with 409 and a "file changed externally" message.
- Append JSONL row to `<VITE_CUBE_MODEL_DIR>/_audit.jsonl`: `{ ts, ua, cubeName, measureName, yamlPatch }`.
- Poll `<cube-api>/meta` (cube base from existing proxy target, or `VITE_CUBE_API_URL`) at 200ms intervals up to 5s; success if `cubes[cubeName].measures[].name` contains `<cubeName>.<measureName>`.
- On poll timeout: restore prior YAML contents (revert via the `.bak` copy created pre-rename), append a rollback row to `_audit.jsonl`, return `504`.

**Non-functional**
- Middleware is mounted only when `mode === 'development'` in `vite.config.ts`.
- No new client-exposed env vars; `VITE_CUBE_MODEL_DIR` is read server-side via `process.env`.
- File I/O uses `fs/promises`; no sync calls inside the request handler.
- **Startup check (Validation Session 1, decision 2):** On dev-server start, the plugin resolves `VITE_CUBE_MODEL_DIR` and verifies the directory exists and is writable. If missing, log a clear warning and respond `500 { ok: false, reason: 'model-dir-not-configured' }` to any request — do NOT crash the dev server. POC assumes a local co-located cube workspace; documented in `.env.example` comment.

## Architecture

```
client ──POST /api/playground/schema/write──▶ vite-middleware
                                                │
                            read .yml + mtime ──┤
                            parse (js-yaml)     │
                            splice measures[]   │
                            write .tmp          │
                            mtime guard         │
                            rename → atomic     │
                            append audit JSONL  │
                            poll /meta (5s)     │
                            ok → 200 + new meta │
                            timeout → restore   │
                                              .bak + 504
```

## Related Code Files

**Create**
- `vite-plugins/schema-write-middleware.ts` — exports a Vite plugin factory `schemaWriteMiddleware()` that gates on `mode`.
- `vite-plugins/yaml-splice.ts` — pure `splice(input: string, measureName: string, yamlPatch: string): { next: string, prior: string }`.
- `vite-plugins/meta-poll.ts` — `waitForMember(baseUrl, cubeName, measureName, { timeoutMs, intervalMs, token })`.
- `vite-plugins/__tests__/yaml-splice.test.ts` — round-trip + idempotency + missing-section cases.

**Modify**
- `vite.config.ts` — register the plugin only when `mode === 'development'`.
- `.env.example` — add `VITE_CUBE_MODEL_DIR=../cube/model` with a comment that it is dev-only and server-side.

## Implementation Steps

1. Add `VITE_CUBE_MODEL_DIR` to `.env.example` with comment "dev-only, server-side; resolves to your local cube schema root".
2. Implement `yaml-splice.ts`:
   - Parse with `yaml.load` (keep `schema` default).
   - Reject if `measures` exists and already contains an entry with the same `name`.
   - Build the new node from `yamlPatch` (parse the patch as a fragment; reject if not a single mapping with required keys).
   - Re-emit using `yaml.dump` with `indent: 2`, `lineWidth: -1`, `noRefs: true`.
   - Return `{ next, prior }` for rollback.
3. Implement `meta-poll.ts` using `fetch` to `<baseUrl>/cubejs-api/v1/meta` with `Authorization: Bearer <token>` if token provided. Resolve when `cubes.find(c => c.name === cubeName)?.measures.some(m => m.name === '<cubeName>.<measureName>')`.
4. Implement `schema-write-middleware.ts`:
   - Plugin shape: `{ name: 'schema-write', apply: 'serve', configureServer(server) { server.middlewares.use('/api/playground/schema/write', handler) } }`.
   - Handler returns 403 if `process.env.NODE_ENV !== 'development'` (belt + braces alongside `apply: 'serve'`).
   - Body parse with `node:stream` consume; cap at 16KB.
   - Validate inputs: `cubeName` matches `/^[A-Za-z_][A-Za-z0-9_]*$/`; `measureName` matches `/^[A-Za-z_][A-Za-z0-9_]*$/`; reject reserved keywords (`joins`, `dimensions`, `segments`, `measures`, `pre_aggregations`, `sql`, `extends`, `data_source`).
   - Resolve `targetPath` under `VITE_CUBE_MODEL_DIR`; reject if not a normal file or outside the configured root (path traversal guard).
   - Read content + mtime → splice → write `<file>.tmp` → stat mtime again → if changed, unlink tmp + return 409.
   - Copy prior content to `<file>.bak` (in-process variable + on-disk safety net), `fs.rename(tmp, target)`.
   - Append JSONL audit row.
   - `waitForMember(...)`; on success return `200 { ok: true, meta }`; on timeout: write prior back via `fs.writeFile`, append rollback row, return `504 { ok: false, reason: 'meta-poll-timeout' }`.
5. Wire plugin in `vite.config.ts` behind `mode === 'development'`.
6. Unit tests for `yaml-splice` covering: missing `measures:` section, existing duplicate, mapping-only patch validation, stable indent.
7. Manual smoke against a real model file: save → confirm `/meta` reflects the new measure, then `git checkout` to revert.

## Todo List

- [ ] Add `VITE_CUBE_MODEL_DIR` to `.env.example`
- [ ] Implement `yaml-splice.ts` + tests
- [ ] Implement `meta-poll.ts`
- [ ] Implement `schema-write-middleware.ts` (includes startup directory check)
- [ ] Wire middleware into `vite.config.ts` (dev only)
- [ ] Manual smoke test against local cube
- [ ] `npm run typecheck` and `npm run test` pass

<!-- Updated: Validation Session 1 - startup check for VITE_CUBE_MODEL_DIR; co-located cube assumption documented -->


## Success Criteria

- [ ] Endpoint refuses to mount in production builds (no route at `/api/playground/schema/write` when `vite build`).
- [ ] Round-trip on a sample `orders.yml` produces a parseable file with the new measure under `measures:`.
- [ ] mtime guard: when the file is edited externally between read and rename, endpoint returns 409 and leaves the file untouched.
- [ ] Audit JSONL contains one row per successful save and one row per rolled-back save.
- [ ] On a successful save, polling `/meta` returns the new measure within 5s.
- [ ] On a synthetic broken YAML, endpoint rolls back the file and returns 504.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Path traversal via `cubeName` | Regex-validate; resolve final path with `path.resolve` and assert it stays under the configured root. |
| Concurrent save corrupts file | mtime guard + write-tmp + rename; rollback if `/meta` poll fails. |
| `js-yaml` dump reorders keys | `noRefs: true`, accept that key order within `measures:` is alphabetical; document this in `_audit.jsonl` so reviewers can replay deltas. |
| Endpoint leaked into prod via misconfigured build | Mount only under `apply: 'serve'`; double-check with `process.env.NODE_ENV` inside handler. |

## Security Considerations

- Dev-only: enforced via `apply: 'serve'` + `NODE_ENV` check.
- No auth (dev tool); document that the user's workstation alone is the trust boundary.
- Body size cap 16KB; reject anything larger.
- File writes confined to `VITE_CUBE_MODEL_DIR`; reject any path that resolves outside it.

## Next Steps

- Phase 2 begins after the endpoint contract is locked (request/response shapes used by Phase 4 `api.ts`).
