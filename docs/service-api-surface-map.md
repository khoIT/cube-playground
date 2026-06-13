# cube-playground — API & Data Surface Map (LOCAL vs PROD)

Debug aid for reconciling discrepancies between LOCAL and the PROD deploy at `https://playground.gds.vng.vn`. PROD has **no server-log access** — debugging = hitting the same endpoint local vs prod and diffing the response.

## How to debug local vs prod

- **PROD base:** `https://playground.gds.vng.vn` — reachable only over **OpenVPN**. SPA is served same-origin behind the deployed Fastify gateway, so `/api/*` and `/cube-api/*` resolve to the deployed gateway with no rewrite. There is **no `VITE_API_BASE`** env — local-vs-prod is decided purely by where the SPA is hosted + the Vite proxy.
- **LOCAL bases (dev):**
  - Fastify gateway (server): `http://localhost:3004` — owns `/api/*`, `/cube-api/*`, `/internal/*`.
  - chat-service: `http://localhost:3005` — gateway proxies `/api/chat/*` and `/api/agent/*` here.
  - Vite SPA: `http://localhost:3000` — proxies `/api` & `/cube-api` → `:3004`; `/playground` & `/cubejs-api` → `:4000` (legacy direct-Cube).
  - Legacy Cube: `http://localhost:4000`.
  - In dev you usually hit the SPA proxy (`:3000`) or the gateway directly (`:3004`). Use `<PORT>` if your gateway runs elsewhere.
- **Deploy:** pushing to the `second` remote (`gitlab.gds.vng.vn/kraken/khoitn`) **auto-deploys to prod**. `origin` (GitHub) does not.
- **Compare method:** issue the *same* request to `http://localhost:3004/api/...` and `https://playground.gds.vng.vn/api/...` with the same headers, then diff. Key axes that diverge local↔prod:
  - **Workspace `authMode`:** prod cube-dev is **open** (`authMode='none'` → Cube token is `null`); local mints/loads a token. So `/api/playground/cube-token` returns `source:'none'` on prod.
  - **Workspace shape:** prod is a **prefix workspace** (one Cube with per-game name prefixes); local is typically a `game_id` workspace. This flips `prefixUnsupported:true` on `/api/business-metrics/drift-center` and changes `/meta` filtering.
  - **Auth:** prod runs real Keycloak/JWT + `enforce-write-roles`; local often runs `AUTH_DISABLED=true` (synthetic dev/admin, write gates skipped).

## Required headers cheat-sheet

| Header | What it does | Which endpoints need it |
|---|---|---|
| `x-cube-workspace` | Selects the workspace (resolves `req.workspace`/`req.cubeCtx`, picks the upstream Cube endpoint + authMode). Unknown → 400 `UNKNOWN_WORKSPACE`; authed user without grant → 403 `WORKSPACE_FORBIDDEN`. Secret-free; `cubeApiUrl` is never returned. | Optional almost everywhere; **load-bearing** for cube proxy, `/api/meta/version`, `/api/identity-map`, `/api/business-metrics*`, segments/dashboards (scopes rows by `req.workspace.id`), `/api/playground/cube-token`. Omit → registry default workspace. |
| `x-cube-game` | On prefix workspaces scopes `/meta` to a game's prefix and mints a game-scoped Cube token. If sent + authed user lacks grant → 403 `GAME_FORBIDDEN`. NOTE: grant check fires only when game arrives as this **header**; routes that take `?game=` re-check the grant in-handler. | Optional. Needed for prefix-workspace meta filtering and `/api/identity-map` (per `api-client.ts`, required there so the token is tenant-scoped and `/meta` isn't empty). |
| `authorization: Bearer <app-JWT>` | App identity. Populates `req.user`/`req.owner` (from JWT `sub`). Used for workspace/game grant filtering and the write-role gate. **Never forwarded to Cube** — the proxy drops it and uses a server-minted token. In `AUTH_DISABLED` mode `req.user` is a synthetic dev/admin so it's optional. | Required for `/api/admin/*`, all write routes under PROTECTED_PREFIXES (`/api/user-prefs`, `/api/cube-aliases`, `/api/business-metrics`, `/api/segments`, `/api/analyses`, `/api/dashboards`, `/api/onboarding`), and `/api/auth/me`. |
| `x-owner` / `X-Owner` | Legacy owner-scope key (sets `req.owner` when no JWT; FE reads `localStorage gds-cube:owner`, fallback `anonymous`). | Owner-scoped rows: segments, dashboards, analyses, cube-aliases, user-prefs, readiness. |
| `x-owner-id` | chat-service owner identity. **Server-authoritative:** the chat proxy resolves owner from the verified `req.owner` (JWT `sub`) FIRST; the client `X-Owner-Id` is only a fallback when `req.owner === 'anonymous'` (dev/legacy/no-JWT). FE chat fetches now also carry the app JWT (see `src/api/chat-auth-headers.ts`). Trusting the client header alone collapsed every user to `dev` and leaked sessions. | All chat-service routes (turn routes 401 `no_owner` without an owner). |
| `x-internal-secret` | Service-to-service shared secret (`== CUBE_AUTH_INTERNAL_SECRET`) for `/internal/access/:key`. Not browser-exposed. | `/internal/access/:key` only. |

## Service: server (Fastify gateway, local `:3004`)

Routes hardcode the full path incl. `/api` (no Fastify prefix). Cube proxy is mounted at `/cube-api/v1/*` (deliberately not `/cubejs-api` so the Vite proxy forwards to Fastify). Write gate = `enforce-write-roles` on PROTECTED_PREFIXES (`/api/user-prefs`, `/api/cube-aliases`, `/api/business-metrics`, `/api/segments`, `/api/analyses`, `/api/dashboards`, `/api/onboarding`); skipped when `AUTH_DISABLED=true`.

### auth & access

| Method | Path | Auth/Roles | Headers | Response | Data sources |
|---|---|---|---|---|---|
| GET | `/api/auth/keycloak/config` | none (public) | — | `{enabled:false}` or KC SSO config | env AUTH_DISABLED/KEYCLOAK_* |
| POST | `/api/auth/keycloak/callback` | none | — | exchanges `code`→app JWT; 200 `{token,user{id,username,email,role,allowedGames,workspaces,features}}` / 403 `ACCESS_PENDING` | Keycloak token ep, access store, users, JWT signer |
| GET | `/api/auth/me` | auth | `authorization` | `{user}` from `req.user` (same shape as callback); 401 if none | `req.user` |
| POST | `/api/auth/logout` | none | — | `{ok:true}` no-op | — |
| GET | `/api/admin/users` | admin | `authorization` | `{users}` | access store |
| GET | `/api/admin/registry` | admin | `authorization` | `{workspaces,games,featureKeys}` | workspaces/games config, FEATURE_KEYS |
| POST | `/api/admin/users` | admin | `authorization` | 201 `{ok,email}` / 409 LastAdmin | access store mutators + audit |
| PATCH | `/api/admin/users/:email` | admin | `authorization` | 200 `{ok}` / 409 LastAdmin | access store + audit |
| PUT | `/api/admin/users/:email/workspaces` | admin | `authorization` | 200 `{ok}` | setWorkspaces + audit |
| PUT | `/api/admin/users/:email/games` | admin | `authorization` | 200 `{ok}` | setGames + audit |
| PUT | `/api/admin/users/:email/features` | admin | `authorization` | 200 `{ok}` | setFeatures + audit |
| GET | `/api/admin/activity/summary` | admin | `authorization` | org rollup `{byStatus,active7d,active30d,inactive[],totalChats,topFeatures}` | activity-aggregator (activity_events + chat `/internal/stats`) |
| GET | `/api/admin/activity/users/:email` | admin | `authorization` | per-user `{lastLogin,sessions,turns,recentFeatures,recentQueryShapes,segments}`; 404 unknown; chat-down→null counts | activity-aggregator |
| GET | `/api/admin/activity/users/:email/sessions` | admin | `authorization`, `?limit` | gap-derived session timeline `{sessions[{start,end,durationMs,events[]}],sessions30,meanDurationMs}`; 404 unknown user; known user w/ no events → empty timeline | session-aggregator (gap-based sessionization from activity_events) |
| GET | `/api/admin/chat/sessions` | admin | `authorization` | cross-user `{sessions}` for `?email=`(req)`&game&q&limit`; 400 no email, 404 unknown user, 502 chat down | resolves email→kcSub, proxies chat-service w/ target `X-Owner-Id` |
| GET | `/api/admin/chat/sessions/:id` | admin | `authorization` | session detail for `?email=`(req) | chat-service proxy (target sub) |
| GET | `/api/admin/chat/turns/:turnId` | admin | `authorization` | turn detail for `?email=`(req) | chat-service proxy (target sub) |
| POST | `/api/activity` | none (owner-scoped) | `authorization`/`x-owner` | 204; client beacon, allowlist `{feature_open,export,workspace_switch}` | activity-store (sub-keyed) |
| GET | `/internal/access/:key` | internal-secret | `x-internal-secret` | `{role,allowedGames,status}` / 404; 503 if secret unset | access store, env |
| GET | `/api/user-prefs` | none (owner-scoped) | `authorization` (→owner) / `x-owner` | flat `{[key]:value}` | DB user_prefs |
| GET | `/api/user-prefs/:key` | none | `authorization`/`x-owner` | `{value}` | DB user_prefs |
| PUT | `/api/user-prefs/:key` | editor, admin | `authorization` | 204 / 400 VALIDATION | DB user_prefs upsert |
| DELETE | `/api/user-prefs/:key` | editor, admin | `authorization` | 204 | DB user_prefs |
| GET | `/api/settings` | none | — | `{[key]:jsonValue}` | app-settings-store |
| PATCH | `/api/settings` | none ⚠️ **not role-gated** | — | 200 `{key,value}` / 400 | app-settings-store |

### cube-core

| Method | Path | Auth/Roles | Headers | Response | Data sources |
|---|---|---|---|---|---|
| GET | `/cube-api/v1/meta` | any (anon) | `x-cube-workspace`, `x-cube-game` (auth dropped) | Cube data-model meta; prefix-filtered per game | external Cube `/meta`, prefix-meta-filter |
| GET/POST | `/cube-api/v1/load` | any | `x-cube-workspace`, `x-cube-game` | Cube result set (data+annotation) | external Cube `/load` |
| GET/POST | `/cube-api/v1/dry-run` | any | `x-cube-workspace`, `x-cube-game` | Cube validation (no exec) | external Cube `/dry-run` |
| GET/POST | `/cube-api/v1/sql` | any | `x-cube-workspace`, `x-cube-game` | compiled SQL+params | external Cube `/sql` |
| POST | `/cube-api/v1/load/:queryHash` | any | `x-cube-workspace`, `x-cube-game` | long-poll continue-wait result | external Cube `/load/<hash>` |
| GET | `/api/playground/cube-token` | any | `x-cube-workspace`, `?game` (req) | `{token,source}`; prod `authMode='none'`→`{token:null,source:'none'}` | resolve-cube-token, gds.config |
| GET | `/api/cube-aliases` | any (read) | `x-cube-workspace`, `x-owner` | `[{cube_name,alias,icon}]` scoped owner+ws | SQLite cube_aliases |
| PUT | `/api/cube-aliases/:cube_name` | editor, admin | `authorization`, `x-cube-workspace`, `x-owner` | 200 upsert / 204 cleared | SQLite cube_aliases |
| DELETE | `/api/cube-aliases/:cube_name` | editor, admin | `authorization`, `x-owner` | 204 | SQLite cube_aliases |
| GET | `/api/meta/version` | any | `x-cube-workspace`, `?force=1` | SHA-256 of last `/meta` payload; 502 CUBE_UNREACHABLE | meta-cache → Cube `/meta` (60s) |
| GET | `/api/workspaces` | any | `authorization` (grant-filters if authed) | `{workspaces:[...]}` secret-free (no cubeApiUrl), grant-filtered by `userCanAccessWorkspace(user,ws)` if user is authed | workspaces.config / workspaces.prod.config, access store |
| GET | `/api/workspaces/:id/games-readiness` | any | — | `{games:[{id,status,cubeCount}]}` | workspace-readiness → Cube `/meta` |
| GET | `/api/workspaces/:id/readiness` | any | `x-owner` | full readiness `{workspace,games,coverage,artifacts}` | readiness → SQLite + Cube `/meta` |
| GET | `/api/playground/games` | any (public) | — | `{games:[...]}` | gds.config.json |

### metrics & glossary

| Method | Path | Auth/Roles | Headers | Response | Data sources |
|---|---|---|---|---|---|
| GET | `/api/business-metrics` | none | `x-cube-workspace`, `?game` | `{metrics}` w/ trust/visibility per game | metrics cache, Cube `/meta`, trust-mapping |
| GET | `/api/business-metrics/drift` | none | `?game` (req) | drift report; 502 DRIFT_FAILED | metrics cache, Cube `/meta` |
| GET | `/api/business-metrics/coverage` | none | `x-cube-workspace`, `?game` | coverage matrix; fail-open per game | metrics cache, Cube `/meta` |
| POST | `/api/business-metrics/scaffold` | editor, admin | `authorization` | 201 `{created,skipped}` (as draft) | YAML writer, audit store |
| GET | `/api/business-metrics/:id` | none | `?game` | single metric w/ trust/visibility / 404 | metrics cache, Cube `/meta`, trust-mapping |
| POST | `/api/business-metrics` | editor, admin | `authorization` | 201 canonical metric (status=draft) | YAML writer, cache, audit |
| PATCH | `/api/business-metrics/:id/trust` | admin | `authorization`, `?game` | 200 metric; certify draft→certified validates Cube refs | YAML, Cube `/meta`, audit, concept-ref-integrity |
| GET | `/api/business-metrics/:id/history` | none | — | `{entries}` newest-first | SQLite audit store |
| GET | `/api/business-metrics/drift-center` | none | `x-cube-workspace`, `?game` (req) | grouped drift; prefix ws → `groups:[]`,`prefixUnsupported:true` | drift-snapshot store, cache, Cube `/meta` |
| PATCH | `/api/business-metrics/:id/repoint` | editor, admin | `authorization` | 200 metric (ref from→to) | YAML, Cube `/meta`, audit |
| PATCH | `/api/business-metrics/:id/applicability` | editor, admin | `authorization` | 200 metric (per-game N/A) | YAML, audit |
| GET | `/api/business-metrics/drift-runs` | none | `?game` (req) | `{runs,intervalMs,lastRunAt,nextRunAt}` | drift-run store |
| POST | `/api/business-metrics/drift-runs/run` | editor, admin | `authorization`, `{game}` | triggers reconcile; runs payload | anomaly-detector, Cube `/meta`, stores |
| POST | `/api/cdp/v1/metrics` | none ⚠️ not gated | — | `{metric_id,status}` proxy to MM-01; 503 NOT_CONFIGURED | external MM-01 CDP API |
| GET | `/api/glossary` | none | `if-none-match` (ETag) `?status` | `{terms}` + weak ETag; 304 | SQLite glossary_terms, metrics cache |
| GET | `/api/glossary/:id` | none | — | term w/ trust/visibility / 404 | SQLite glossary_terms, trust-mapping |
| POST | `/api/glossary` | editor, admin | `authorization` | 201 term (status=draft, validates secondaryCatalogIds) / 409 | SQLite glossary_terms, concept-ref-integrity |
| PUT | `/api/glossary/:id` | editor, admin | `authorization` | updated term (validates refs) / 409 DANGLING_REF | SQLite glossary_terms |
| PATCH | `/api/glossary/:id/status` | admin | `authorization` | draft↔official; certify validates Cube refs | SQLite glossary_terms, Cube `/meta`, concept-ref-integrity |
| DELETE | `/api/glossary/:id` | editor, admin | `authorization` | 204 / 409 seed_protected / 409 dangling_refs | SQLite glossary_terms, concept-ref-integrity |
| GET | `/api/concepts/:namespace/:id/relations` | none | — | `{concept, edges}` w/ trust/visibility | concept-reverse-index, Cube `/meta` |
| POST | `/api/concepts/promote` | editor, admin | `authorization` | 201 `{term?, metric?, segment}` IDOR-safe | SQLite glossary/metrics, YAML writer, promote-to-term |

### segments, identity, liveops

| Method | Path | Auth/Roles | Headers | Response | Data sources |
|---|---|---|---|---|---|
| GET | `/api/segments` | none | `x-cube-workspace`, `x-owner` `?owner,type,q,sort,game_id` | hydrated segments (no uid_list, visibility default personal) scoped to ws | SQLite segments/segment_tags, trust-mapping |
| POST | `/api/segments` | editor, admin | `authorization`, `x-owner` | 201 segment (visibility=personal default) | SQLite, translator, refresh-queue |
| GET | `/api/segments/:id` | none ⚠️ not ws/owner scoped | `x-cube-workspace` | full segment + card_cache + visibility / 404 | SQLite, card-cache-store, trust-mapping |
| PATCH | `/api/segments/:id` | editor, admin + **owner 403** | `authorization`, `x-owner` | updated segment | SQLite, translator, refresh-queue |
| DELETE | `/api/segments/:id` | editor, admin + **owner 403** | `authorization`, `x-owner` | 204 | SQLite segments |
| POST | `/api/segments/:id/append` | editor, admin (no owner check) | `authorization` | `{uid_count}` | SQLite segments |
| POST | `/api/segments/import-ids` | editor, admin | `authorization`, `x-owner` | 201 `{id,uid_count,truncated,errors}` | SQLite, cube_identity_map, csv-importer |
| GET | `/api/segments/:id/refresh-log` | none | `?days,limit` | `[LogRow]` / 404 | SQLite segment_refresh_log |
| POST | `/api/segments/refresh-logs` | editor, admin (read but POST-gated) | `authorization` | `Record<id,LogRow[]>` | SQLite segment_refresh_log |
| GET | `/api/segments/:id/sql-filter` | none | — | `{filter}` / 400 SQL_TRANSLATOR_ERROR | SQLite, predicate-to-sql |
| POST | `/api/segments/:id/refresh` | editor, admin (no owner) | `authorization` | 202 `{status:'refreshing'}` / 400 NOT_LIVE | SQLite, refresh-queue |
| GET | `/api/segment-refresh/snapshot-runs` | admin | `authorization` | `{runs:[{instance,status,lastRunAt,definitionsPartition,membershipPartition}]}` | Trino latest-partition + SQLite heartbeat, 10-min TTL |
| GET | `/api/segment-refresh/:id/runs` | admin | `authorization` | `{runs:[{startedAt,finishedAt,source,total,ok,failed,failingCards,runError}]}` newest-first, ≤5 | SQLite segment_card_run (persisted card-pass history) |
| GET | `/api/segment-refresh/:id/cards` | admin | `authorization` | `{cards:[{cardId,status,error,fetchedAt,lastAttemptAt}]}` | SQLite segment_card_cache (persisted per-card statuses) |
| POST | `/api/segment-refresh/snapshot-runs/trigger` | admin | `authorization` | 202 `{started:true}` / 409 ALREADY_RUNNING | manual lakehouse snapshot (bypasses SEGMENT_SNAPSHOT_ENABLED; idempotent writers) |
| POST | `/api/segments/:id/share` | owner, admin | `authorization`, `x-owner` | 200 segment (shared_at set) / 403 owner | SQLite segments |
| POST | `/api/segments/:id/unshare` | owner, admin | `authorization`, `x-owner` | 200 segment (shared_at cleared) / 403 owner | SQLite segments |
| GET | `/api/segments/:id/brief` | none | `?lang=(en\|vi),?refresh=1` | 200 `{brief,status,stale?}` / 502 (retryable) | segment_brief_cache, chat-service /internal/segment-brief |
| GET | `/api/segments/:id/members/:uid/panels` | none | — | `{panels:[]}` cached per-uid views / 400 NO_MEMBER360 | segment_member360_cache, Cube (live fallback) |
| GET | `/api/segments/:id/member-cache-status` | none | — | `{members:[{uid,status,error?}]}` aggregate ok/error tally | segment_member360_cache |
| POST | `/api/segments/:id/precompute-members` | editor, admin (manual trigger) | `authorization` | 202 `{queued}` / 400 REFRESH_IN_PROGRESS | member360-precompute-scheduler |
| GET | `/api/segments/:id/trajectory` | none | `x-cube-workspace` | `{trajectory:[{day,size,entered,exited}]}` 30-day history / 404 non-predicate | segment-trajectory-reader, 1h cache, LAKEHOUSE_UNAVAILABLE |
| GET | `/api/segments/:id/metric-series` | none | `x-cube-workspace`, `?metric,?lens=(current\|entry\|stayers)` | `{series:[{day,value,memberCount}],cohortType,registry?}` / 404 non-queryable | segment-metric-series-reader, registry-gated, deadJoinWarning |
| GET | `/api/segments/:id/eligible-metrics` | none | — | `{metrics:[{id,name,display_name}]}` queryable metrics per game | segment-metric-registry |
| GET | `/api/segments/:id/cs-care` | none | — | `{coverage{totalMembers,contactedMembers,pct,truncated},freshness{csMaxLogDate},pulse{tickets,contacted,openUnresolved,negativeSentiment,lowRating},issueMix[{category,tickets,members}],watchlist[{uid,name,ltv,lastCategory,lastSource,sentiment,rating,statusGroup,daysSince,riskScore}],csImpact{contacted,nonContacted,windowDays,smallSample}\|null}` gated predicate+CS-game only; 404 NO_CS_CARE; 6h TTL; recharge-fail degrades csImpact→null (200); CS-read-fail → 502 | lakehouse/cs-product-map, lakehouse/cs-ticket-reader, lakehouse/cs-recharge-trajectory, segment-cs-care-assembly |
| POST | `/api/segments/:id/activations` | editor, admin + **owner 403** | `authorization`, `x-owner` | 201 segment + activation | SQLite (CDP stub) |
| DELETE | `/api/segments/:id/activations/:activationId` | editor, admin + **owner 403** | `authorization`, `x-owner` | segment w/ activation removed | SQLite |
| GET | `/api/identity-map` | none | `x-cube-workspace`, `x-cube-game` | merged overrides + auto-suggest rows | SQLite cube_identity_map, identity-suggester (Cube `/meta`) |
| GET | `/api/settings/identity-map` | none | (alias) | same as above | (inject) |
| PUT | `/api/identity-map/:cube` | none ⚠️ not gated | `x-cube-workspace` | upserted row (logical space) | SQLite, cube-member-resolver |
| PUT | `/api/settings/identity-map/:cube` | none ⚠️ alias | `x-cube-workspace` | upserted row | (inject) |
| DELETE | `/api/identity-map/:cube` | none ⚠️ not gated | `x-cube-workspace` | 204 | SQLite, cube-member-resolver |
| GET | `/api/liveops/kpi-strip` | none | `?game` (req) | 200 cached / 202 warming / 503 / 400 | liveops cache, meta-version, refresh-liveops |
| GET | `/api/liveops/cohort` | none | `?game,window` | cached cohort grid (key game:window) | liveops cache, meta-version |
| POST | `/api/liveops/funnel` | none (POST=query) | `{game,funnelDef}` | cached funnel / 202 / 503 | liveops cache, meta-version |
| POST | `/api/liveops/refresh` | none | `{resource,cacheKey}` | forced refresh 200/202 | liveops cache, refresh-liveops |
| GET | `/api/liveops/cache-status` | none | `?game` (req) | `{kpi_strip,cohort_grid}` | liveops cache |

### analyses, anomalies, dashboards

| Method | Path | Auth/Roles | Headers | Response | Data sources |
|---|---|---|---|---|---|
| GET | `/api/segments/:segmentId/analyses` | none | `x-owner` | `[analysis]` newest-first / 404 | SQLite segments/segment_analyses |
| POST | `/api/segments/:segmentId/analyses` | editor, admin | `authorization`, `x-owner` | 201 analysis | SQLite segment_analyses |
| GET | `/api/segments/:segmentId/analyses/:id` | none | — | analysis / 404 | SQLite segment_analyses |
| PATCH | `…/analyses/:id` | editor, admin + **owner 403** | `authorization`, `x-owner` | updated / 403 owner | SQLite segment_analyses |
| DELETE | `…/analyses/:id` | editor, admin + **owner 403** | `authorization`, `x-owner` | 204 / 403 owner | SQLite segment_analyses |
| GET | `/api/anomalies` | none | `?game (req),status` | `{anomalies,game,status}` | anomaly-state-store |
| POST | `/api/anomalies/:id/ack` | none ⚠️ not gated | — | `{ok,id,status:'ack'}` | anomaly-state-store |
| POST | `/api/anomalies/:id/snooze` | none ⚠️ not gated | `{until}` | `{ok,id,status:'snoozed'}` | anomaly-state-store |
| GET | `/api/anomaly-state` | none | `?game (req)` | `{states,source}` (deprecation shim) | anomaly-state-store + YAML fallback |
| GET | `/api/dashboards` | none | `x-cube-workspace`, `x-owner`, `?game (req)` | `[dashboard]`; empty→seed starter pack | SQLite dashboards, Cube `/meta`, seeder |
| POST | `/api/dashboards/reset-starter-pack` | editor, admin | `authorization`, `?game (req)` | 200 seed result | SQLite, Cube `/meta`, seeder |
| POST | `/api/dashboards` | editor, admin | `authorization`, `x-owner` | 201 / 409 SLUG_CONFLICT | SQLite dashboards |
| GET | `/api/dashboards/:slug` | none | `x-cube-workspace`, `x-owner`, `?game (req)` | dashboard + per-tile `cache` / 404 | SQLite dashboards + tile cache |
| PATCH | `/api/dashboards/:slug` | editor, admin | `authorization`, `?game (req)` | updated dashboard | SQLite dashboards |
| DELETE | `/api/dashboards/:slug` | editor, admin | `authorization`, `?game (req)` | 204 | SQLite dashboards |
| POST | `/api/dashboards/:slug/tiles` | editor, admin | `authorization`, `?game (req)` | 201 tile / 409 tile_cap_exceeded (8) | SQLite, refresh-dashboard-tiles, Cube |
| PATCH | `/api/dashboards/:slug/tiles/:id` | editor, admin | `authorization` | updated tile (re-refresh if query changed) | SQLite, tile cache, Cube |
| DELETE | `/api/dashboards/:slug/tiles/:id` | editor, admin | `authorization` | 204 | SQLite tiles |
| POST | `/api/dashboards/:slug/view-ping` | editor, admin | `authorization`, `?game (req)` | 204 (best-effort) | SQLite dashboards |
| POST | `/api/dashboards/:slug/tiles/:id/refresh` | editor, admin | `authorization`, `x-cube-workspace` | 200 cache view / 202 warming | refresh-dashboard-tiles, Cube, tile cache |
| PUT | `/api/dashboards/:slug/layout` | editor, admin | `authorization`, `?game (req)` | 204 | SQLite dashboards/tiles |

### care (VIP-care playbooks, cases, governance)

| Method | Path | Auth/Roles | Headers | Response | Data sources |
|---|---|---|---|---|---|
| GET | `/api/care/playbooks` | none (viewer-ok) | `?game (req)` | `[{id, name, priority, condition, watchedMetric, kpi, channel, dataRequirements, status, available}]` merged seed ⊕ overrides, per-game availability gated | playbook-registry, playbook-merge, Cube `/meta` |
| POST | `/api/care/playbooks` | editor, admin | `authorization`, `{name, threshold_rule, supplemental_predicate, enabled}` | 201 override (new playbook or threshold tune) | care-playbooks-override DB table, audit |
| PATCH | `/api/care/playbooks/:id` | editor, admin | `authorization`, `{name?, threshold_rule?, supplemental_predicate?, enabled?}` | 200 updated override | care-playbooks-override, audit |
| DELETE | `/api/care/playbooks/:id` | editor, admin | `authorization` | 204 (reverts override, seed re-surfaces) | care-playbooks-override, audit |
| POST | `/api/care/playbooks/:id/preview-count` | editor, admin | `authorization`, `?game (req)`, `{condition, supplementalPredicate?}` | `{matched, elapsedMs, gated, note?}` READ-ONLY live VIP count for a candidate condition (no writes); reuses the sweep compile/gate path so count == what a sweep would open. `409 PLAYBOOK_UNAVAILABLE` / `502 PREVIEW_FAILED`. `:id` = display id or `new` | mergePlaybooks + makeCubeCohortFetcher, Cube `/load` |
| GET | `/api/care/cases` | none (viewer-ok) | `?game (req),?playbook (comma-list),?status (comma-list),?page,?pageSize` | `{cases: [{id, uid, playbook_id, playbook_name, playbook_priority, status, opened_at, …, profile}], total, page, pageSize}` paginated, enriched w/ VIP profile snapshots | care_cases table, playbook-merge, SQLite profile store |
| GET | `/api/care/cases/by-vip` | none (viewer-ok) | `?game (req),?q (substring search on uid\|name),?page,?pageSize` | `{vips: [{uid, caseCount, topPriority, playbooks: [{id, name, priority}], profile}], total, page, pageSize}` open cases deduplicated by VIP, ranked by priority then count | care_cases, profile-enriched |
| GET | `/api/care/cases/vip/:uid` | none (viewer-ok) | `?game (req)` | `{uid, cases: [{id, playbook_id, playbook_name, playbook_priority, status, opened_at, …}]}` full case history for one VIP cross-playbook | care_cases |
| PATCH | `/api/care/cases/:id` | editor, admin | `authorization`, `{status?, assignee?, channel_used?, action_taken?, notes?, outcome?, kpi_eval_at?, condition_lapsed?}` | 200 case updated | care_cases, audit |
| POST | `/api/care/cases/sweep` | editor, admin | `authorization`, `?game (req)`, `?playbook (optional — scope sweep to one playbook)` | 202 `{game, opened, lapsed, profilesRefreshed, summaries: [{playbook_id, opened, lapsed, skipped_reason?}]}` async or 409 SWEEP_BUSY / 502 SWEEP_FAILED. With `?playbook`, sweeps only that segment (per-segment manual sweep from the builder); shares the same per-(workspace,game) mutex | Cube cohort query, member sweep logic, profile refresh |
| GET | `/api/care/governance` | none (viewer-ok) | `?game (req)` | `{maxProactivePerVipPer24h, cooldowns: {call_days, zalo_hours, in_game_hours, push_hours}}` org-wide fatigue rules (defaults if not set per game) | care_governance table |
| PUT | `/api/care/governance` | admin | `authorization`, `{maxProactivePerVipPer24h?, cooldowns?}` | 200 updated rules | care_governance |
| GET | `/api/care/fatigue` | none (viewer-ok) | `?game (req),?uid (req),?channel,?priority` | `{blocked: boolean, reason?: string, lastContactAt?, cooldownUntil?}` fatigue verdict for a proposed outreach | care_cases, contact history |
| GET | `/api/care/sweeps/runs` | none (viewer-ok) | `?game (req),?limit` | `[{id, game, createdAt, triggeredBy, opened, lapsed, profilesRefreshed}]` paginated sweep run snapshots | care_sweep_runs table |
| GET | `/api/care/sweeps/trend` | none (viewer-ok) | `?game (req),?playbook` | `{trends: [{playbook_id, playbook_name, runs: [{runId, cohortSize, openedCount}]}]}` cohort-size trend per playbook across runs | care_sweep_runs, care_sweep_membership |
| GET | `/api/care/sweeps/diff` | none (viewer-ok) | `?game (req),?runA (req),?runB (req)` | `{diffs: [{playbook_id, playbook_name, entered, left, deltaSize}]}` per-playbook count + membership deltas | care_sweep_membership |
| GET | `/api/care/sweeps/diff/vips` | none (viewer-ok) | `?game (req),?runA (req),?runB (req),?playbook (req),?direction (entered\|left),?page,?pageSize` | `{vips: [{uid, profile}], total, page, pageSize, membershipAvailable}` paginated VIP drill for membership flow | care_sweep_membership, profile-enriched |

### chat proxy, onboarding, misc (gateway → chat-service `:3005`)

| Method | Path | Auth/Roles | Headers | Response | Data sources |
|---|---|---|---|---|---|
| POST | `/api/chat/sessions/:id/turn` | none (owner req) | `x-owner-id`/`x-owner`, `x-cube-workspace`, `x-cube-game`, `x-model`, `x-web-search`, `x-research-mode`, `x-bypass-cache` | SSE turn stream; 503 no_cube_token / 502 / 409 turn_in_progress | chat-service `/agent/turn`, cube-token mint |
| GET | `/api/chat/sessions/:sessionId/stream-replay` | none (owner req) | `x-owner-id`, `?turnId (req),from` | SSE replay; 409 ring_overflow | chat-service `/agent/turn/:id/stream` |
| POST | `/api/agent/turn/:turnId/cancel` | none (owner req) | `x-owner-id` | cancel 202/410 | chat-service `/agent/turn/:id/cancel` |
| GET | `/api/chat/sessions` | none (owner fallback) | `x-owner-id`, `?game,q` | own session list (owner-scoped) | chat-service `/sessions` |
| GET | `/api/chat/sessions/shared` | none (owner req) | `x-owner-id`, `?game,q` | cross-owner shared session list | chat-service `/sessions/shared` |
| GET | `/api/chat/sessions/:id` | none | `x-owner-id` | session detail; owner OR `visibility=shared`; `readOnly` flag for non-owner | chat-service `/sessions/:id` |
| POST | `/api/chat/sessions/:id/share`·`/unshare` | none (owner req) | `x-owner-id` | publish/unpublish to team (owner-only 403) | chat-service `/sessions/:id/(un)share` |
| GET/DELETE | `/api/chat/sessions/:id/focus` | none (DELETE owner req) | `x-owner-id` | focus bag / clear | chat-service `/api/chat/sessions/:id/focus` |
| GET | `/api/chat/starter-questions` | none (owner-agnostic) | `x-cube-workspace`, `?game (req)` | per-(workspace, game) generated starter set `{questions, source: static-fallback\|template\|llm, status, metaHash}`; lazy template gen + background LLM refine, meta-hash staleness | chat-service `/api/chat/starter-questions`, Cube `/meta`, SQLite `starter_question_sets` |
| DELETE | `/api/chat/sessions/:id` | none (owner fallback) | `x-owner-id` | soft-archive | chat-service `/sessions/:id` |
| PATCH | `/api/chat/sessions/:id` | none (owner req) | `x-owner-id`, `{title}` | rename | chat-service `/sessions/:id` |
| GET | `/api/chat/notifications` | none (owner req) | `x-owner-id`, `?unread,limit` | notifications | chat-service `/notifications` |
| POST | `/api/chat/notifications/:id/read` | none (owner req) | `x-owner-id` | mark read | chat-service |
| GET | `/api/chat/audit/intents` | none (owner req) | `x-owner-id`, `?limit` | recent intents | chat-service `/audit/intents` |
| POST | `/api/chat/audit` | none (owner req) | `x-owner-id` | UI event log | chat-service `/audit` |
| GET | `/api/chat/stats` | none (owner req) | `x-owner-id`, `?owner,from,to` | usage stats | chat-service `/stats` |
| GET | `/api/chat/debug/leaderboard/skills` | none (owner req) | `x-owner-id`, `?game,days` | skill leaderboard | chat-service `/debug/...` |
| GET | `/api/chat/debug/cache-effectiveness` | none (owner req) | `x-owner-id`, `?game,days,topN,q` | cache metrics | chat-service `/debug/...` |
| GET | `/api/chat/debug/sessions[/:id]` | none (owner req) | `x-owner-id` | debug sessions | chat-service `/debug/sessions` |
| GET | `/api/chat/debug/turns/:turnId[/raw]` | none (owner req) | `x-owner-id` | turn detail / raw events | chat-service `/debug/turns` |
| POST/DELETE | `/api/chat/debug/turns/:turnId/annotation` | none ⚠️ not gated (owner req) | `x-owner-id` | star/flag/note | chat-service `/debug/...` |
| GET | `/api/chat/debug/search[/cached]` | none (owner req) | `x-owner-id`, `?q,…` | turn / cached-query search | chat-service `/debug/search` |
| DELETE | `/api/chat/debug/cache` | none ⚠️ not gated (owner req) | `x-owner-id`, `?game` | `{deleted}` | chat-service `/debug/cache` |
| GET | `/api/onboarding/connectors` | none | `x-owner` | `{configured,connectors}` (secret-free) | trino-profiler-config, connector-store |
| GET | `/api/onboarding/source-types` | none | — | `{sourceTypes}` | source-type-registry |
| GET | `/api/onboarding/example-model` | none (game grant re-check) | `?game (req)` | committed cube-dev YAML | existing-model-reader |
| POST | `/api/onboarding/connectors/test` | editor, admin | `authorization` | `{ok,latencyMs?}` (SSRF-guarded) | connector-provisioning |
| POST | `/api/onboarding/connectors` | editor, admin | `authorization` | 201 connector | connector-provisioning, store, host-guard |
| PATCH | `/api/onboarding/connectors/:id` | editor, admin | `authorization` | edited connector / 403 READ_ONLY | connector-store, provisioning |
| POST | `/api/onboarding/connectors/:id/disable` | editor, admin | `authorization` | `{disabled,id}` | connector-store |
| GET | `/api/onboarding/connectors/:id/audit` | none | — | `{audit}` | connector-store |
| GET | `/api/onboarding/cross-source-links` | none | `?workspaceId` | `{links}` + verdict | cross-source-link-store, advisor |
| POST | `/api/onboarding/cross-source-links` | editor, admin | `authorization` | 201 `{link,verdict}` / 400 SAME_SOURCE | cross-source-link-store |
| DELETE | `/api/onboarding/cross-source-links/:id` | editor, admin | `authorization` | `{removed,id}` | cross-source-link-store |
| GET | `/api/onboarding/introspect` | none (game grant re-check) | `?connectorId,schema,game` | `{tables}`; 503 PROFILER_NOT_CONFIGURED | trino-profiler, profiler-interface |
| POST | `/api/onboarding/generate` | editor, admin (game re-check) | `authorization`, `{game,tables,…}` | `{drafts}` | profiler, inference, scaffolder, draft-store |
| GET | `/api/onboarding/drafts[/:id]` | none | `?game,status` | `{drafts}` / `{draft,audit}` | onboarding-draft-store |
| POST | `/api/onboarding/drafts/:id/accept` | editor, admin (game re-check) | `authorization` | `{draft}` accepted | draft-store |
| POST | `/api/onboarding/drafts/:id/reject` | editor, admin (game re-check) | `authorization` | `{draft}` rejected | draft-store |
| POST | `/api/onboarding/drafts/:id/validate` | editor, admin | `authorization` | `{structural,live}`; live only if written | draft-store, Cube `/load` |
| POST | `/api/onboarding/cross-game-join` | editor, admin (dual-game) | `authorization` | `{draft,note}` / 409 CROSS_SOURCE | draft-store, model-reader, scaffolder |
| POST | `/api/onboarding/drafts/:id/approve` | editor, admin (game re-check) | `authorization` | `{draft,written}`; 403 SELF_APPROVE_FORBIDDEN / WRITE_DISABLED_IN_PRODUCTION | draft-store, model-writer (cube-dev), Cube |
| POST | `/api/onboarding/drafts/:id/enrich` | editor, admin | `authorization` | `{enabled,suggestions}` (LLM, flag-gated) | draft-store, enrichment |
| GET | `/api/onboarding/drafts/:id/golden` | none (game re-check) | — | `{enabled,members,totalQueries}` | draft-store, golden-query-seeder |
| GET | `/api/presets` | none | — | static `Preset[]` | in-code PRESETS |
| POST | `/api/preview` | none (POST=query) | `x-cube-workspace`, `{predicate_tree,primary_cube}` | count estimate + Cube query + SQL; 502 CUBE_UPSTREAM | preview-service → Cube `/load` + `/sql` |
| POST | `/api/__fixtures__/segments` | none (DEV-ONLY, not in prod) | — | 204 reset seed | SQLite (dev only, NODE_ENV≠production) |

## Service: chat-service (local `:3005`)

Direct base in dev; in prod reached only via the gateway `/api/chat/*` + `/api/agent/*` proxy. All routes need `x-owner-id`; turn/cancel/stream additionally check ownership (403). Rate limit (default 30/owner/min) + per-session mutex apply only to `/agent/turn`.

| Method | Path | Auth/Roles | Headers | Response | Data sources |
|---|---|---|---|---|---|
| GET | `/health` | none | — | `{ok,db,sdk}` | SQLite chat.db, ANTHROPIC_API_KEY |
| POST | `/agent/turn` | owner | `x-owner-id`(=body), `x-cube-token` (req), `x-cube-game`(=body), `x-cube-workspace`, `x-model`, `x-web-search`, `x-research-mode`, `x-bypass-cache` | SSE turn; 409 turn_in_progress / 429 rate_limited | chat.db, stream-registry, response_cache, Agent SDK (ANTHROPIC_BASE_URL egress proxy), Langfuse, server cube/glossary/segments/business-metrics callbacks |
| POST | `/agent/turn/:turnId/cancel` | owner | `x-owner-id` | 202/410 | stream-registry, chat_sessions |
| GET | `/agent/turn/:turnId/stream` | owner | `x-owner-id`, `?from` | SSE replay+tail; 409 ring_overflow | stream-registry ring (TTL 300s), chat_sessions |
| GET | `/sessions` | owner | `x-owner-id`, `x-cube-workspace`, `?game (req),q` | session rows (ws-partitioned) | chat_sessions |
| GET | `/sessions/:id` | owner | `x-owner-id` | `{session,turns,activeTurnId}` | chat_sessions + chat_turns, stream-registry |
| PATCH | `/sessions/:id` | owner | `x-owner-id`, `{title}` | updated session | chat_sessions |
| DELETE | `/sessions/:id` | owner | `x-owner-id` | 204 soft-delete | chat_sessions, snapshot mirror |
| POST | `/sessions/:id/restore` | owner | `x-owner-id` | restored session | chat_sessions |
| GET | `/stats` | owner | `x-owner-id`(=`?owner`), `?from,to` | `{turns,tokens,cost_usd,by_skill}` | chat_turns, cost config |
| POST | `/audit` | owner | `x-owner-id`, `{kind,…}` | 204 | chat_audit |
| GET | `/audit/intents` | owner | `x-owner-id`, `?limit` | `{intents}` | chat_audit |
| GET | `/notifications` | owner | `x-owner-id`, `?unread,limit` | `{items,unread}` | notifications |
| POST | `/notifications/:id/read` | owner | `x-owner-id` | 204 | notifications |
| GET | `/notifications/scheduler` | none (diagnostic) | — | `{jobs}` | scheduler service |
| GET | `/api/chat/user-prefs` | owner | `x-owner-id`, `x-cube-token`, `?gameId (req)` | `{items}` w/ resolved labels | user_prefs, cube-meta-cache |
| DELETE | `/api/chat/user-prefs/:slot` | owner | `x-owner-id`, `?gameId` | 204 | user_prefs |
| DELETE | `/api/chat/user-prefs` | owner | `x-owner-id`, `?gameId` | 204 (all) | user_prefs |
| GET | `/api/chat/sessions/:id/focus` | owner | `x-owner-id` | `{focus,hasSdkResume}` | chat_sessions, focus KV |
| DELETE | `/api/chat/sessions/:id/focus` | owner | `x-owner-id` | 204 (atomic clear + SSE focus_reset) | chat_sessions, focus, kv_cache, stream-registry |
| GET | `/debug/sessions[/:id]` | owner | `x-owner-id`, `?game,q,limit` | debug session(s) incl. deleted | chat_sessions, observability-store |
| POST | `/debug/sessions/:id/restore` | owner | `x-owner-id` | restored | chat_sessions |
| DELETE | `/debug/sessions/:id` | owner | `x-owner-id` | 204 hard-purge / 409 if live | chat_sessions |
| GET | `/debug/turns/:turnId[/raw]` | owner | `x-owner-id`, `?cursor,limit` | `{llmCalls,toolInvocations,…}` / raw events | llm_calls, tool_invocations, sdk_events, kv_cache |
| POST/DELETE | `/debug/turns/:turnId/annotation` | owner | `x-owner-id`, `{starred,flag,note}` | annotation upsert / 204 | annotations |
| GET | `/debug/search[/cached]` | owner | `x-owner-id`, `?q,game,…` | `{results,nextCursor}` | turn-search-store / response_cache |
| GET | `/debug/leaderboard/skills` | owner | `x-owner-id`, `?game,days` | `{skills,computedAt}` | leaderboard-store |
| DELETE | `/debug/cache` | owner | `x-owner-id`, `?game (req)` | `{deleted}`; 403 if no sessions in game | response_cache, chat_sessions |
| GET | `/debug/cache-effectiveness` | owner | `x-owner-id`, `?game,days,topN,q` | hit-rate/savings metrics | cache-effectiveness-store |

## Service: frontend-consumer (Vite SPA `:3000`)

No client hardcodes a host — all use **relative** paths. `apiFetch` (api-client.ts) auto-attaches `Accept`, `X-Owner`, `x-cube-workspace`, `x-cube-game`, `Authorization: Bearer`, `Content-Type`. Some clients (liveops, glossary, cube-token, all chat-*) use **raw fetch** and attach a different/smaller header set — noted below.

| Method | Path | Client / headers | Response | Notes |
|---|---|---|---|---|
| * | base-url resolution | Vite proxy: `/api`,`/cube-api`→`:3004`; `/playground`,`/cubejs-api`→`:4000`. PROD same-origin. | — | Only browser envs: `VITE_CUBE_API_URL`, `VITE_CDP_ACTIVATION_ENABLED` |
| — | Feature-access gate | `src/auth/feature-access.ts`: `useHasFeature()` hook gates sidebar sections, Data bottom-nav (gated by `data-model`), Settings tabs; `<FeatureRouteGuard/>` mounted in `src/index.tsx` redirects disabled feature URLs to `/settings`. Mirrors server `userHasFeature`: default-on except `admin` (default-off). | boolean | `user.features[key]` from login callback; 404→true (bootstrapping) |
| GET/POST/PATCH/DELETE | `/api/segments[/...]` | apiFetch (full header set) | Segment(s) | row-picker etc. |
| POST | `/api/preview` | apiFetch | count + query + SQL | segment count preview |
| GET/PUT | `/api/identity-map[/:cube]` | apiFetch — `x-cube-game` **required** | CubeIdentityMapping | so token tenant-scoped, `/meta` non-empty |
| GET | `/api/presets` | apiFetch | Preset[] | |
| GET | `/api/playground/games` | apiFetch | GamesConfig | |
| GET/POST/PATCH/DELETE/PUT | `/api/dashboards[/...]` | apiFetch, `?game` | Dashboard(s)/Tile/204 | grid layout, view-ping, refresh |
| GET/POST | `/api/liveops/{kpi-strip,cohort,funnel,refresh}` | **raw fetch** — only `Accept`/`Content-Type`, **no owner/ws/game/auth headers** | CachedView \| WarmingResponse | 202=warming non-error; keyed by `game` |
| GET/POST/PATCH/DELETE | `/api/onboarding/...` | apiFetch | connectors/drafts/links | writes 403 for viewer server-side |
| POST | `/api/cdp/v1/metrics` | apiFetch — only if `VITE_CDP_ACTIVATION_ENABLED=true` else synthetic mock | CreateMetricResult | mock middleware in dev |
| GET/POST/PUT/PATCH/DELETE | `/api/glossary[/...]` | **raw fetch** — only `Accept`/`Content-Type`, **no scope/auth headers** | GlossaryTerm(s)/204 | |
| GET | `/api/playground/cube-token` | **raw fetch**, no scope headers, `?game` | `{token,source}` | 404/network→null (keeps pasted token) |
| POST | `/api/chat/sessions/:id/turn` | **raw fetch** + AbortController — `X-Owner-Id`, `x-cube-workspace`, optional `X-Bypass-Cache`/`X-Model`/`X-Web-Search`/`X-Research-Mode`. **No Bearer.** | SSE stream | sessionId null/'new'→server creates |
| GET | `/api/chat/sessions/:id/stream-replay` | raw fetch — `X-Owner-Id`, `?turnId,from` | SSE replay | reattach after refresh |
| POST | `/api/agent/turn/:turnId/cancel` | raw fetch — `X-Owner-Id` | 202/410/network | stop generating |
| GET/DELETE | `/api/chat/sessions/:id/focus` | raw fetch — `X-Owner-Id` | focus / 204 | errors→null/false (chip hides) |
| DELETE | `/api/chat/sessions/:id` | raw fetch — `X-Owner-Id` | ok | owner-enforced server-side |
| POST | `/api/chat/audit` | raw fetch — `X-Owner-Id`, keepalive | ignored | fire-and-forget |
| GET/POST | `/api/chat/notifications[/:id/read]` | raw fetch — `X-Owner-Id` | items / ok | empty on error |
| GET/DELETE | `/api/chat/user-prefs[/:slot]` | raw fetch — `X-Owner-Id`, **`X-Cube-Token`** (not Authorization) | rows / ok | |
| GET | `/api/chat/debug/cache-effectiveness` | DevAudit page hook | CacheEffectivenessResponse | consumer is page hook, not a *-client |
| GET | `/cube-api/v1/meta` (+ `/load` via SDK) | apiFetch / @cubejs-client via cube-api-factory — `x-cube-workspace`+`x-cube-game`; SDK sends token as `authorization` | MetaCube[] | proxy **drops** client Authorization, re-mints upstream token from ws+game |

## Local-vs-prod probes

Replace `<TOKEN>` with an app JWT (or omit in `AUTH_DISABLED` local). Set `WS`/`GAME` to a real workspace id + game. For PROD prepend the VPN base; PROD cube-dev is open so cube-token returns `null`.

```bash
# 1. Workspaces registry (secret-free) — confirms prod vs local workspace shape
curl -s http://localhost:3004/api/workspaces | jq
curl -s https://playground.gds.vng.vn/api/workspaces | jq
# discrepancy → different workspace set / authMode / gamePrefixMap; prod = prefix workspace

# 2. Cube /meta via gateway proxy — the schema both sides actually see
curl -s -H "x-cube-workspace: $WS" -H "x-cube-game: $GAME" \
  "http://localhost:3004/cube-api/v1/meta" | jq '.cubes | length'
curl -s -H "x-cube-workspace: $WS" -H "x-cube-game: $GAME" \
  "https://playground.gds.vng.vn/cube-api/v1/meta" | jq '.cubes | length'
# discrepancy → cube-dev model drift between local and prod (sibling cube-dev repo not synced)

# 3. Meta version hash — fast drift fingerprint
curl -s -H "x-cube-workspace: $WS" "http://localhost:3004/api/meta/version" | jq
curl -s -H "x-cube-workspace: $WS" "https://playground.gds.vng.vn/api/meta/version" | jq
# discrepancy → different /meta payloads; pair with probe #2 to see which cubes differ

# 4. Per-game cube token — exposes authMode difference
curl -s -H "x-cube-workspace: $WS" "http://localhost:3004/api/playground/cube-token?game=$GAME" | jq
curl -s -H "x-cube-workspace: $WS" "https://playground.gds.vng.vn/api/playground/cube-token?game=$GAME" | jq
# prod should be {token:null,source:'none'}; if local mints a token, FE Cube-call headers differ

# 5. Business metrics registry + trust (depends on /meta resolution)
curl -s -H "x-cube-workspace: $WS" "http://localhost:3004/api/business-metrics?game=$GAME" | jq '.metrics | length'
curl -s -H "x-cube-workspace: $WS" "https://playground.gds.vng.vn/api/business-metrics?game=$GAME" | jq '.metrics | length'
# discrepancy → metric YAMLs differ OR trust downgraded because refs miss against one side's /meta

# 6. Drift center — prefix workspaces (prod) return prefixUnsupported:true
curl -s -H "x-cube-workspace: $WS" "http://localhost:3004/api/business-metrics/drift-center?game=$GAME" | jq '{prefixUnsupported, groups: (.groups|length)}'
curl -s -H "x-cube-workspace: $WS" "https://playground.gds.vng.vn/api/business-metrics/drift-center?game=$GAME" | jq '{prefixUnsupported, groups: (.groups|length)}'
# expected divergence: prod prefixUnsupported=true; if local also true, workspace shape mismatch

# 7. Glossary (raw fetch, no scope headers) — same on both unless DB differs
curl -s "http://localhost:3004/api/glossary?status=official" | jq '.terms | length'
curl -s "https://playground.gds.vng.vn/api/glossary?status=official" | jq '.terms | length'
# discrepancy → glossary_terms DB seed differs between environments

# 8. Segments list (owner + workspace scoped)
curl -s -H "x-cube-workspace: $WS" -H "x-owner: $OWNER" "http://localhost:3004/api/segments?game_id=$GAME" | jq 'length'
curl -s -H "x-cube-workspace: $WS" -H "x-owner: $OWNER" "https://playground.gds.vng.vn/api/segments?game_id=$GAME" | jq 'length'
# discrepancy → owner/workspace scoping mismatch or separate SQLite DBs (expected: per-env DB)

# 9. Identity map (x-cube-game REQUIRED so token is tenant-scoped, /meta non-empty)
curl -s -H "x-cube-workspace: $WS" -H "x-cube-game: $GAME" "http://localhost:3004/api/identity-map" | jq '.[].cube'
curl -s -H "x-cube-workspace: $WS" -H "x-cube-game: $GAME" "https://playground.gds.vng.vn/api/identity-map" | jq '.[].cube'
# discrepancy → auto-suggest rows differ (driven by /meta) or persisted overrides differ; on prefix ws names are physicalized

# 10. LiveOps KPI strip (raw, no scope headers) — 200 vs 202 warming tells cache state
curl -s "http://localhost:3004/api/liveops/kpi-strip?game=$GAME" | jq '{status, expires_at, error_msg}'
curl -s "https://playground.gds.vng.vn/api/liveops/kpi-strip?game=$GAME" | jq '{status, expires_at, error_msg}'
# 202=warming (cold cache, refreshing); 503=Cube unreachable; status:'broken'/'error' → upstream Cube query failure

# 11. chat-service health (LOCAL direct only; prod has no direct 3005 — probe via SSE turn instead)
curl -s http://localhost:3005/health | jq
# discrepancy → db:false (SQLite missing) or sdk:'missing-key' (ANTHROPIC_API_KEY unset)

# 12. Chat turn SSE (gateway proxy) — verifies chat enabled + cube token mint end-to-end
curl -N -H "x-owner-id: $OWNER" -H "x-cube-workspace: $WS" -H "x-cube-game: $GAME" \
  -H "Content-Type: application/json" \
  -d '{"message":"ping","game":"'"$GAME"'"}' \
  "https://playground.gds.vng.vn/api/chat/sessions/new/turn"
# 404 {chat_disabled} → CHAT_FEATURE_ENABLED off; 503 no_cube_token → token mint failed; 502 → chat-service unreachable
```

## Maintenance

Regenerate this map via the **map-service-api-surface** workflow whenever routes change (new endpoints, header/role/scoping changes, or PROTECTED_PREFIXES edits). The inventory is fanned out per service domain; keep the per-service tables and the probes section in sync with the route files cited in the inventory (`server/src/routes/*`, chat-service `src/api/*`, FE `src/api/*-client.ts`).
