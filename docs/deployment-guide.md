# Deployment Guide

Operational reference for deploying GDS Cube (playground) with DB-authoritative
authorization, Keycloak→Microsoft SSO, and the cube-dev shared authz source.

## Auth & Authz model (summary)

- **Authentication** = Keycloak. In prod, KC brokers Microsoft/Entra OIDC with
  JIT user creation; KC issues a token carrying a stable `sub`, `email`, `name`.
  No app roles or per-game groups are configured in KC anymore.
- **Authorization** = the app SQLite store, keyed by **lowercased email**:
  - `user_access(email, role, status, kc_sub, …)` — role + `pending|active|disabled`.
  - `user_workspace_access`, `user_game_access` — per-user grants.
  - `feature_flags(scope, subject, feature_key, enabled)` — `role`/`user` scoped.
- **Default-deny:** a user authenticated by KC but without an `active` row is
  blocked (`403 ACCESS_PENDING`); a pending row is auto-created for the admin
  queue. Role + grants are resolved from the DB **per request** (not the JWT).
- **Admin page** (`/admin/access`) writes the DB only — no Keycloak Admin API.
- **cube-dev** enforces per-user game access via its `checkAuth` → `auth-db.js`,
  which queries the playground's internal access API (the minted Cube token's
  `userId` is the user's email).

## Environment variables — playground server

| Var | Required | Purpose |
|-----|----------|---------|
| `JWT_SECRET` | yes | HS256 secret for the app JWT (≥16 chars). |
| `AUTH_DISABLED` | no | `true` = dev bypass (synth admin, all games/features). Unset/false in prod. |
| `KEYCLOAK_URL` / `KEYCLOAK_REALM` / `KEYCLOAK_CLIENT_ID` | prod | KC OIDC config for the code-exchange + FE redirect. |
| `KEYCLOAK_CLIENT_SECRET` | prod | KC confidential-client secret. |
| `AUTH_BOOTSTRAP_ADMINS` | prod (cutover) | Comma-separated emails seeded as `active` admins on every boot. **Set before the first prod deploy to avoid lockout.** |
| `ACCESS_CACHE_TTL_MS` | no | Access-store cache TTL (default 30000). Revocations take effect within this window. |
| `AUTHZ_GRANT_FALLBACK` | no | `true` (default) = users with no grants in a dimension fall back to role-based defaults (eases migration). Flip **OFF** after grants are seeded so gates fail closed. |
| `CUBE_AUTH_INTERNAL_SECRET` | prod | Shared secret guarding `GET /internal/access/:key` (cube-dev calls it). Must match cube-dev's `AUTH_INTERNAL_SECRET`. |
| `CUBEJS_API_SECRET` | prod (minted ws) | Secret used to mint the Cube JWT (`userId=email`, per-game claim). |
| `CUBE_PLAYGROUND_USER_ID` | no | Service-principal id used when no real user is present (default `playground`). |

## Environment variables — cube-dev

| Var | Purpose |
|-----|---------|
| `AUTH_API_URL` | Playground base URL (e.g. `http://playground-server:3004`). When set, `auth-db.js` queries the internal API instead of the JSON file. |
| `AUTH_INTERNAL_SECRET` | Shared secret; must equal playground `CUBE_AUTH_INTERNAL_SECRET`. |
| `AUTH_CACHE_TTL_MS` | Per-user lookup cache TTL (default 60000). |
| `AUTH_API_TIMEOUT_MS` | Internal API call timeout (default 3000). On error → **fail closed** (deny). |
| `AUTH_USERS_FILE` | Local-dev file fallback used only when `AUTH_API_URL` is unset. |

## Keycloak Microsoft (Entra) brokering — setup

1. Register an Entra app (or reuse the VNG SSO app): client id/secret; redirect
   URI = the KC broker endpoint `/realms/<realm>/broker/microsoft/endpoint`.
2. In KC: add a Microsoft OIDC Identity Provider; enable "trust email";
   first-broker-login flow = create user + link by email.
3. Add attribute mappers for `email` and `name` only — **no** role/group mappers
   (authorization is app-side now).
4. Register the app's prod redirect URI (`<app-origin>/auth/callback`) on the KC
   client.
5. Smoke test: a Microsoft login completes the app callback. The user is
   `pending` (403 ACCESS_PENDING) until an admin grants access — expected.

## Rollout sequence (zero-lockout)

1. Deploy the DB migrations; set `AUTH_BOOTSTRAP_ADMINS` and verify those emails
   resolve as active admins (they can reach `/admin/access`).
2. Enable the Microsoft IdP in KC.
3. Pre-provision known users by email via the admin page/API (status `active`,
   with workspace/game/feature grants).
4. Flip `AUTHZ_GRANT_FALLBACK=false` once grants are seeded (gates fail closed).
5. Point cube-dev at the internal API (`AUTH_API_URL` + secret); it fails closed
   on lookup error. Final cross-repo smoke: a PTG-only user is allowed PTG and
   `403`'d for another game at Cube (test through the proxy `:3004`).

**Break-glass:** `AUTH_DISABLED=true` bypasses all authz (synth admin) — and
now also opens the in-stack cube bridge: `/internal/access` returns an
all-games admin (`allowedGames: ['*']`, which `cube/cube.js#checkAuth` expands
to every supported tenant), so the **`local`** workspace loads `/meta` and
switches games with no login and no per-game grants — the same posture as local
dev. The SSO wall is also down (`/api/auth/keycloak/config` → `enabled:false`).
⚠️ This makes the entire prod app (every game, every feature, admin pages) open
to anyone who can reach the domain — local / internal / emergency only, never a
hardened-prod default. Flip back to `false` to restore Keycloak + DB-default-deny.
(Data queries still need `CUBEJS_DB_*` Trino creds; `/meta` + game switching do not.)

## Containerized deploy (Docker)

The app ships as three built images (one multi-stage `Dockerfile`, targets
`server`, `chat-service`, `web`) plus two official Cube images, all wired by
`docker-compose.prod.yml`:

```
web (nginx) ──SPA + proxies /api,/cube-api──▶ server :3004 ──/api/chat──▶ chat-service :3005
                                                 ├─▶ cube_api :4000 (`local` ws) ──▶ cubestore :3030
                                                 │      └─ cube_api ──auth-db──▶ server /internal/access
                                                 └─▶ external: cube.gds.vng.vn (`prod` ws), Trino, LiteLLM, Keycloak
```

- **`web`** serves the built SPA and reverse-proxies `/api` + `/cube-api` to the
  server on the same origin (`docker/nginx.conf`); it publishes `PUBLIC_PORT`.
- **`server`** and **`chat-service`** are internal; SQLite lives on named volumes
  (`server-data`, `chat-data`) so DBs survive redeploys.
- **`cube_api`** + **`cubestore`** are the in-stack Cube semantic layer, vendored
  from `data-product/cube-dev` into `./cube-dev/` (config + models only; runs from
  `cubejs/cube` + `cubejs/cubestore`, no build). Backs the **`local`** workspace
  (`gameModel=game_id`); the **`prod`** workspace stays external (`cube.gds.vng.vn`).
  Multi-tenant — `CUBEJS_DEV_MODE=false`, minted JWT carries the game claim;
  `auth-db.js` resolves grants via `AUTH_API_URL=http://server:3004`. Published on
  `CUBE_PUBLIC_PORT` (17001, Playground) + `CUBE_SQL_PORT` (15432, SQL API). Server
  reaches it internally at `http://cube_api:4000`. Pre-aggs on `cubestore_data`.
  To refresh models: re-vendor `cube-dev/cube/` from the source repo and redeploy.
- `better-sqlite3` (native) is compiled in-image — the host needs only Docker.

Build + run (after the CI `vault` stage writes `.env` next to the compose file):

```bash
docker compose -f docker-compose.prod.yml build
PUBLIC_PORT=11000 docker compose -f docker-compose.prod.yml up -d
```

GIO points the prod domain at `PUBLIC_PORT`.

### Secrets ↔ topology split

One **flat** Vault secret → CI writes one `.env` → compose `env_file` injects it
into **both** Node services (chat-service reads `process.env` via `dotenv/config`;
no separate `chat-service/.env` is needed in the container). **Local dev is
unchanged** — it keeps its own root `.env` and `chat-service/.env`.

Keep **topology in compose, secrets in Vault**. These are set per-service in
compose and must **not** go in Vault (a shared `PORT` would collide):
`PORT`, `DB_PATH`, `CHAT_DB_PATH`, `CHAT_SERVICE_URL` (`http://chat-service:3005`),
`SERVER_BASE_URL` (`http://server:3004`).

`VITE_*` are **build-time** baked into the `web` image (Vite inlines them); pass
via build args, not runtime env. Default `VITE_CUBE_API_URL=/cube-api/v1`
(same-origin via nginx).

### Vault key manifest (path: `…/prod/<owner>/<project>`)

Flat KV. ⚠️ = boot-blocking if absent.

| Key | Req | Notes |
|-----|-----|-------|
| `AUTH_DISABLED` | yes | **`false`** in prod. `true` = full bypass: synth admin, SSO wall down, **and** the in-stack cube `local` workspace opens to all games (no login, no grants). Dev/break-glass only — see Break-glass note. |
| `JWT_SECRET` | yes | app-JWT signing (≥16 chars). |
| `KEYCLOAK_URL` / `_REALM` / `_CLIENT_ID` | yes | KC OIDC config. |
| `KEYCLOAK_CLIENT_SECRET` | yes | confidential client. |
| `AUTH_BOOTSTRAP_ADMINS` | yes | seed admin emails — set before first deploy or lock-out. |
| `CUBE_AUTH_INTERNAL_SECRET` | yes | must equal cube-dev `AUTH_INTERNAL_SECRET`; in-stack `cube_api` reuses it as `AUTH_INTERNAL_SECRET`. |
| `CUBEJS_API_SECRET` | yes | mints the per-game Cube JWT; shared by `server` (mint) + in-stack `cube_api` (verify) — values must match. |
| `CUBEJS_DB_HOST` / `_PORT` / `_USER` / `_PASS` | yes¹ | Trino creds for the in-stack `cube_api` (copy from cube-dev `.env`). ¹Required once the `local` workspace is used; `cube_api` boots but can't query Trino without them. |
| `CUBEJS_DB_CATALOG` / `_SSL` | no | in-stack cube; default `game_integration` / `false` (compose), override in Vault if prod Trino differs. |
| `CUBESTORE_TAG` | ⚠️do-not-set | leave UNSET in prod — compose defaults to amd64 `:latest`, matching the cube-api images already cached on the kraken runner (so no cold Hub pull). The arm64v8 tag (local Apple Silicon) silently wedges cubestore on the x86-64 runner. |
| `CUBEJS_REFRESH_WORKER` | no | default `false` (compose); flip to `true` only after pre-aggregations are defined, else it pegs CPU. |
| `CUBE_PLAYGROUND_USER_ID` | no | service principal (default `playground`). |
| `CHAT_FEATURE_ENABLED` | yes | `true` to run chat. |
| `ANTHROPIC_BASE_URL` | ⚠️ | LiteLLM gateway URL — chat-service won't boot without it. |
| `ANTHROPIC_API_KEY` | ⚠️ | LiteLLM key — chat-service won't boot without it. |
| `CUBE_API_URL` | ~~Vault~~ | **Moved to compose** (`server.environment`, `http://cube_api:4000`) — it's a URL not a secret. Used by the non-workspace server paths (dashboards meta, preview, card-runner, anomaly); chat-service ignores it. Remove from Vault. |
| `LITELLM_BASE_URL` / `_API_KEY_STG` / `_MODEL` | cond | server-side LLM features. |
| `CONNECTOR_SECRET_KEY` | cond | DB-connector secret vault (32-byte base64). |
| `TRINO_PROFILER_HOST` / `_PORT` / `_USER` / `_PASS` / `_CATALOG` / `_SSL` / `_WORKSPACE` | cond | onboarding profiler. |
| `MAIN_SERVER_SERVICE_TOKEN` | cond | chat↔server callback auth (same value both sides). |
| `LANGFUSE_PUBLIC_KEY` / `_SECRET_KEY` / `_HOST` | cond | observability. |

Full secret-free reference lives in `.env.example`.
