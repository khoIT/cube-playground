# Phase 02 — Extended Tool Surface (5 remaining tools)

## Context Links

- Brainstorm: `/Users/lap16299/Documents/code/cube-playground/plans/reports/brainstorm-260523-1643-cube-playground-chat-agent.md` (§5 tool table, §17 row 4)
- Server scout: `/Users/lap16299/Documents/code/cube-playground/plans/reports/scout-260523-1643-cube-playground-chat-surface.md` (§2, §3)
- Phase 01: `./phase-01-chat-service-skeleton-and-core-tools.md`
- Plan overview: `./plan.md`

## Overview

- **Priority:** P1 — required so Phase 04/05 skills have a complete surface.
- **Current status:** pending (blocked by Phase 01).
- **Description:** Add the 5 remaining tools to the chat-service tool registry. Each is a thin call into existing `server/`-side services or Cube — chat-service reaches them via the server proxy (HTTP) to keep one source of truth. No new business logic; all wiring + Zod schemas + per-tool tests.

## Key Insights

- Brainstorm §5: tools call into `business-metrics-loader`, segments service, and Cube `/sql`. All exist in `server/src/services/`. Chat-service must NOT duplicate them — call via HTTP.
- Brainstorm §17 row 4: all 8 tools land in Phase 1a (1a-core = Phase 01, 1a-tools = Phase 02).
- Scout §2: server already exposes `/api/business-metrics`, `/api/business-metrics/:id`. Segments live behind `/api/segments`, `/api/segments/:id`. Cube SQL: `server/src/services/cube-client.ts:73-78` already has `sql(query)` helper.
- Brainstorm §12 row "YAML business-metric IDs change": server already watches files in dev — chat-service can re-fetch via HTTP without local cache invalidation.

## Requirements

### Functional

1. Tool `list_business_metrics({ query?, tier? })` returns trimmed list `[{ id, label, description, tier, formula, unit, game_compatibility }]`.
2. Tool `get_business_metric({ id })` returns full YAML object (synonyms, related_concepts, etc.).
3. Tool `list_segments({ game })` returns `[{ id, name, type, uid_count, last_refreshed_at }]`.
4. Tool `get_segment({ id })` returns predicate + cube + identity_dim + sample rows.
5. Tool `explain_cube_sql({ query })` returns compiled SQL string for transparency.
6. All 5 tools available to skills declared in `allowed_tools` frontmatter.

### Non-functional

- Each tool unit-tested with mocked HTTP fetch / mocked Cube client (no live calls).
- Tool errors surface as `{ ok: false, error, detail }` so the LLM can self-correct.
- Tool registry lookup is O(1).
- chat-service `tsc --noEmit` clean.

## Architecture

```
LLM → tool_call
       ↓
chat-service/src/tools/<tool>.ts handler
       ↓ HTTP GET ${SERVER_BASE_URL}/api/...   (uses ctx.cubeToken / ctx.ownerId)
server/ existing route
       ↓
existing service (business-metrics-loader / segments / cube-client)
```

No changes to `server/`. chat-service tool handlers receive `ToolContext` (already defined in Phase 01) and use `ctx.serverBaseUrl` + `ctx.ownerId` to call existing endpoints.

For `explain_cube_sql`: handler calls server-proxied Cube `/sql` (server has no direct endpoint for that today, so introduce a thin pass-through). Decision: bypass server and call Cube directly using `ctx.cubeToken` — same pattern as `preview_cube_query` in Phase 01. Keeps zero new server routes.

## Related Code Files

### MODIFY

- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/tools/registry.ts` — register 5 new tools.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/.claude/skills/explore/SKILL.md` — extend `allowed_tools` to include the new tools (still stub; full content Phase 04).

### CREATE

- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/tools/list-business-metrics.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/tools/get-business-metric.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/tools/list-segments.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/tools/get-segment.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/tools/explain-cube-sql.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/src/services/server-client.ts` — minimal HTTP client to `${SERVER_BASE_URL}/api/...`; forwards `X-Owner-Id`.
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/tool-list-business-metrics.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/tool-get-business-metric.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/tool-list-segments.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/tool-get-segment.test.ts`
- `/Users/lap16299/Documents/code/cube-playground/chat-service/test/tool-explain-cube-sql.test.ts`

### DELETE

None.

## Implementation Steps

### 1. Server-client helper

1. Create `chat-service/src/services/server-client.ts` with `getJson<T>(path: string, ctx: ToolContext): Promise<T>` and `postJson<T>(path, body, ctx)`. Adds `X-Owner-Id: ctx.ownerId`. Throws on non-2xx.
2. `tsc --noEmit`. Pass.

### 2. Tool: list_business_metrics

1. Zod input: `{ query: z.string().optional(), tier: z.union([z.literal(1), z.literal(2)]).optional() }`.
2. Handler: `getJson('/api/business-metrics', ctx)` → filter by `query` (substring on `id`/`label`/`synonyms`) and `tier` if provided.
3. Output Zod schema covers trimmed fields per requirement 1.
4. `test/tool-list-business-metrics.test.ts`: mock `getJson` with 4 fixture metrics; assert filter behaviour.
5. Register in `registry.ts`.

### 3. Tool: get_business_metric

1. Zod input: `{ id: z.string().min(1) }`.
2. Handler: `getJson('/api/business-metrics/<id>', ctx)`. 404 → `{ ok: false, error: 'not_found', detail }`.
3. Test: mock 200 + 404 paths.

### 4. Tool: list_segments

1. Zod input: `{ game: z.string().min(1) }`.
2. Handler: `getJson('/api/segments?game=<game>&owner=<ctx.ownerId>', ctx)` — return trimmed rows.
3. Confirm against existing `server/src/routes/segments.ts` for query-param contract.
4. Test: mock 200 + empty + 500.

### 5. Tool: get_segment

1. Zod input: `{ id: z.string().min(1) }`.
2. Handler: `getJson('/api/segments/<id>', ctx)`. Return `{ id, name, type, predicate_json, primary_cube, identity_dim, sample_uids, uid_count, last_refreshed_at }`.
3. Test: mock returns plausible row.

### 6. Tool: explain_cube_sql

1. Zod input: `{ query: CubeQuerySchema }`.
2. Handler: validate query against `cube-meta-cache.getMeta(ctx.gameId)` (reuse Phase 01 validator). Then call Cube `/sql` directly using `ctx.cubeToken` (mirror `preview_cube_query` pattern). Return `{ sql: string }`. **Pretty-print via `sql-formatter`** (user decision 2026-05-23) — add `sql-formatter` to `chat-service/package.json` deps, use `format(rawSql, { language: 'postgresql' })`. Trino dialect not yet supported by `sql-formatter`; postgresql is close enough for display purposes.
3. Test: mock Cube fetch; assert SQL returned.

### 7. Registry update

1. `registry.ts` import + register all 5 tools. Verify keys unique.
2. Extend `explore` skill frontmatter `allowed_tools: [get_cube_meta, list_business_metrics, get_business_metric, list_segments, get_segment, preview_cube_query, explain_cube_sql, emit_query_artifact]`.
3. `tsc --noEmit && vitest run`. Pass.
4. **Commit:** `feat(chat-service): extended tool surface (list/get business-metrics, segments, explain_cube_sql)`.

### 8. Manual smoke

1. With chat-service running, ask `/chat/new` "what is the formula for ROAS?" → assistant calls `get_business_metric` → renders formula in text.
2. Ask "list segments for game ptg" → calls `list_segments`.

## Todo List

- [ ] 1. `server-client.ts` helper
- [ ] 2. `list_business_metrics` tool + test
- [ ] 3. `get_business_metric` tool + test
- [ ] 4. `list_segments` tool + test
- [ ] 5. `get_segment` tool + test
- [ ] 6. `explain_cube_sql` tool + test
- [ ] 7. Registry wiring + skill frontmatter update + `tsc --noEmit` clean
- [ ] 8. Manual smoke for at least 2 tools

## Success Criteria

- All 5 new tool tests green.
- chat-service exposes 8 tools total via registry.
- `tsc --noEmit` clean.
- Manual smoke produces sensible tool_call/tool_result events for at least `get_business_metric` and `list_segments`.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Server `/api/segments` query-param contract drift | Re-grep `server/src/routes/segments.ts` before wiring; reflect actual params in tool. |
| `explain_cube_sql` exposes secrets in SQL string | Cube `/sql` response is the same SQL `/build` already shows; no new exposure surface. |
| `business-metrics-loader` cache stale (file edit) | Server already hot-reloads in dev; chat-service re-fetches every call (no local cache) — accept the latency hit for freshness. |
| LLM mis-uses `get_segment` for a non-existent id | Tool returns `{ ok: false, error: 'not_found' }` → LLM apologises and reroutes. |

## Security Considerations

- All tools forward `X-Owner-Id`; server filters list endpoints by owner. Cross-owner reads remain blocked.
- `explain_cube_sql` reuses `ctx.cubeToken` minted per session — game-scoped; cannot reach other game schemas.
- No new env vars introduced.

## Next Steps

- Unblocks Phase 05 (`compare` + `diagnose` need `list_business_metrics`, `get_business_metric`, `list_segments` available).
- Phase 04 starts in parallel since `explore` + `metric_explain` use the same tools.

## Unresolved Questions

1. Should `list_segments` filter by owner only, or also include shared/public segments? Default: trust existing server endpoint behaviour.
2. ~~`explain_cube_sql` pretty-printing — pull `sql-formatter` into chat-service deps or return raw?~~ **RESOLVED 2026-05-23:** add `sql-formatter` to chat-service deps; pretty-print with postgresql dialect.
