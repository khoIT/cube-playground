# Cube Segments Server

Fastify + better-sqlite3 backend for the Segments feature.

## Quick start

```bash
npm install
npm run dev        # tsx watch on :3002
```

From repo root:

```bash
npm run dev:all    # Vite (:3000) + server (:3002) concurrently
```

## Environment variables

| Variable       | Default                    | Description                          |
|--------------- |--------------------------- |------------------------------------- |
| `PORT`         | `3002`                     | Listening port (changed from 3001 to avoid collision with the hermes catalog-api running on the same dev box) |
| `DB_PATH`      | `./data/segments.db`       | SQLite file path (`':memory:'` for tests) |
| `CUBE_API_URL` | `http://localhost:4000`    | Base URL for the Cube instance       |
| `CUBE_TOKEN`   | _(empty)_                  | Bearer token for Cube auth           |

## Auth posture (v1)

**No real authentication.** The `X-Owner` request header is read as a plain string and stored/compared without any token validation. This is a dev-tool convenience posture — any caller can impersonate any owner by setting the header. A real auth layer (JWT, session, etc.) is a v1.5 follow-up. Do not expose this server directly to untrusted networks.

## Endpoints

All responses are JSON. Errors use `{ error: { code, message } }`.

### Segments

| Method | Path                          | Description                                      |
|--------|-------------------------------|--------------------------------------------------|
| GET    | `/api/segments`               | List segments. Filters: `owner`, `type`, `q`, `sort` |
| POST   | `/api/segments`               | Create segment; translates `predicate_tree` → `cube_query_json` |
| GET    | `/api/segments/:id`           | Fetch single segment with tags + hydrated predicate |
| PATCH  | `/api/segments/:id`           | Update (owner required). Re-runs translator if `predicate_tree` changes |
| DELETE | `/api/segments/:id`           | Delete (owner required)                          |
| POST   | `/api/segments/:id/append`    | Merge `{ uids: string[] }` into uid list (de-duped) |
| POST   | `/api/segments/:id/refresh`   | Mark `status='refreshing'` → 202 (cron executes the actual refresh) |

### Analyses

| Method | Path                                              | Description              |
|--------|---------------------------------------------------|--------------------------|
| GET    | `/api/segments/:segmentId/analyses`               | List saved analyses      |
| POST   | `/api/segments/:segmentId/analyses`               | Pin a Cube query         |
| GET    | `/api/segments/:segmentId/analyses/:id`           | Fetch single analysis    |
| PATCH  | `/api/segments/:segmentId/analyses/:id`           | Update (owner required)  |
| DELETE | `/api/segments/:segmentId/analyses/:id`           | Delete (owner required)  |

### Identity map

| Method | Path                          | Description                                        |
|--------|-------------------------------|----------------------------------------------------|
| GET    | `/api/identity-map`           | Return all saved cube→identity_field mappings      |
| PUT    | `/api/identity-map/:cube`     | Upsert manual mapping `{ identity_field, confidence? }` |

### Presets

| Method | Path             | Description                          |
|--------|------------------|--------------------------------------|
| GET    | `/api/presets`   | List available preset definitions (v1: `mf_users-hub` only) |

### Meta

| Method | Path                   | Description                                         |
|--------|------------------------|-----------------------------------------------------|
| GET    | `/api/meta/version`    | SHA-256 of last Cube `/meta` response; `?force=1` bypasses 60s cache |

### Health

| Method | Path           |
|--------|----------------|
| GET    | `/api/health`  |

## List query parameters (`GET /api/segments`)

| Param   | Default          | Description                                          |
|---------|------------------|------------------------------------------------------|
| `owner` | _(none)_         | Filter by owner; `*` returns all owners              |
| `type`  | _(none)_         | `manual` or `predicate`                              |
| `q`     | _(none)_         | Substring match on `name`                            |
| `sort`  | `created_at`     | `created_at` (default) or `name`                     |

## Translator

`src/services/translator.ts` converts between the canonical AND/OR predicate tree stored in `predicate_tree_json` and Cube `Query.filters` arrays.

- Root AND group flattens to a top-level filter array (Cube implicit AND).
- Nested OR/AND groups emit `{ or: [...] }` / `{ and: [...] }` objects.
- Supported operators: `equals`, `notEquals`, `gt`, `lt`, `gte`, `lte`, `in`, `notIn`, `contains`, `set`, `notSet`, `inDateRange`, `beforeDate`, `afterDate`.

## Scripts

```bash
npm run dev      # tsx watch (hot-reload)
npm run build    # tsc → dist/
npm run start    # node dist/index.js
npm run test     # vitest
```
