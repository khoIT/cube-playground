# Per-Game Filter & Scoping Mechanism — Investigation Report

## Executive Summary

Per-game scoping in cube-playground is a **dual-layer architecture**:
1. **FE layer**: Game context selector (React) → localStorage → URL-param override
2. **BE layer**: Workspace config (game_id vs prefix models) + per-request headers + token-level enforcement

The app implements **TWO workspace models simultaneously**:
- **`game_id` (local/dev)**: One cube per concept (e.g., `mf_users`), scoped by gameId dimension
- **`prefix` (prod)**: Every game's cubes share one schema, name-spaced per-game (e.g., `cfm_mf_users`, `ballistar_mf_users`)

New cross-cutting data-model layers MUST respect the workspace model to inherit per-game scoping automatically.

---

## 1. Per-Game Filter / Game Selector (UI → Cube Routing)

### GameContextProvider: Frontend Selection Logic
**File:** `src/components/Header/use-game-context.ts:104–322`

**Core Lifecycle:**
- **Init** (lines 126–146): Fetch `gds.config.json` (game registry), resolve URL `?game=`, fallback to localStorage, then default
- **Persist** (lines 99–102): `setPref(STORAGE_KEY, id)` → server-pref store (DB + localStorage mirror)
- **Re-sync** (lines 150–156): Listen for server-pref hydration from other tabs
- **Workspace Narrowing** (lines 230–254): Filter games by:
  1. Active workspace's `gameModel`:
     - `prefix` model: Only allow games in `gamePrefixMap` keys
     - `game_id` model: All games pass through
  2. Per-workspace RBAC grants (real-auth only)
  3. Per-workspace readiness (games whose Cube schema resolves)

**Key Functions:**
```typescript
export function narrowGamesByWorkspaceGrant(pool, isRealAuth, workspaceId, authUser)
  // Applies per-workspace game grants from authUser.gamesByWorkspace[workspaceId]
  // Fail-closed: absent grant → empty pool (real-auth only)
  // Admins bypass narrowing entirely
```

**Storage Keys:**
- `gds-cube:active-game` → `getActiveGameId()` / `setGameId()`
- `gds-cube:workspace` → workspace context (separate context)

### How Game is Propagated to Cube

**FE Headers on Every Request:**
1. `api-client.ts:76–102` — Shared fetch wrapper attaches:
   - `x-cube-workspace` from `getActiveWorkspaceId()` (lines 88–91)
   - `x-cube-game` from `getActiveGameId()` (lines 99–102)
   - Authorization header (Bearer token)

2. **QueryBuilder SDK calls** (`src/QueryBuilderV2/QueryBuilder.tsx:lines ~135–150`):
   ```typescript
   const headers: Record<string, string> = {};
   if (workspaceId) headers['x-cube-workspace'] = workspaceId;
   if (activeGameId) headers['x-cube-game'] = activeGameId;
   // Passed to CubeJS HttpTransport
   ```

3. **Server-side Cube token minting** (`server/src/middleware/workspace-header.ts:50–69`):
   - `buildCtx(workspace, gameId, userId)` calls `resolveCubeTokenForWorkspace(workspace, gameId, userId)`
   - JWT payload includes `{ game: 'cfm', userId: 'user@vng', ... }`
   - Minted at request time, scoped to active workspace + gameId

---

## 2. Cube-Name → Game Mapping (Namespace Models)

### Local (`game_id`) Model
**File:** `cube-dev/cube/cube.js:1–50` (lines 18–50 define schema mapping)

**Structure:**
```
cube-dev/cube/model/
  cubes/
    cfm/
      mf_users.yml       ← Bare cube name, scoped by gameId dimension
      recharge.yml
    jus/
      mf_users.yml       ← Same name in different folder
      recharge.yml
    ballistar/, cros/, tf/, ... (8 games total)
```

**Cube routing (line 335–355):**
```javascript
repositoryFactory: ({ securityContext }) => ({
  dataSchemaFiles: async () => {
    const game = gameFor(securityContext);  // Reads JWT game claim
    const files = [];
    for (const kind of ['cubes', 'views']) {
      const dir = path.join(MODEL_ROOT, kind, game);
      // Load ONLY the game's subdir
      // Missing dirs are tolerated (e.g., ptg has only 3 cubes)
    }
    return files;
  }
})
```

**Per-tenant isolation via:**
1. **Compile cache** (line 275): `contextToAppId: () => 'cube_' + gameFor(securityContext)`
   - Each game gets its own compiled schema
2. **Orchestrator** (line 280): `contextToOrchestratorId: () => 'orch_' + gameFor(securityContext)`
   - Each game's query queue isolated
3. **Pre-agg schema** (line 292): `preAggregationsSchema: () => 'preagg_' + gameFor(securityContext)`
   - Each game's rollups stored separately (prevents cross-tenant table collision)
4. **Trino schema** (line 305): `schema: GAME_SCHEMA[gameFor(securityContext)]`
   - Routes to cfm_vn, jus_vn, ballistar_vn, cros, etc.

### Prod (`prefix`) Model
**Local Mirror:** `workspaces.prod.config.json` (lines 19–24):
```json
"gameModel": "prefix",
"gamePrefixMap": {
  "cfm_vn": "cfm",
  "ballistar": "ballistar",
  "cros": "cros",
  "jus_vn": "jus"
}
```

**Cube naming convention:**
```
Logical:   mf_users.ltv_vnd
Physical:  cfm_mf_users.ltv_vnd  (when workspace is prod, activeGameId is cfm_vn)
```

Every game's cubes share one Trino schema (e.g., `game_integration`), but are namespace-separated in Cube YAML:
- `cfm_mf_users.yml`
- `ballistar_mf_users.yml`
- `jus_mf_users.yml`
- etc.

---

## 3. Member Resolver / Workspace Abstraction

### Location & Contract
**FE:** `src/lib/cube-member-resolver.ts:1–125`
**Server:** `server/src/services/cube-member-resolver.ts:1–144` (mirrored)

Both implement the same contract — a central logical ↔ physical member translator.

### Function Signatures

**Resolve game prefix:**
```typescript
export function resolveGamePrefix(workspace, gameId): string | null
  // workspace.gameModel='prefix' + gameId → workspace.gamePrefixMap[gameId]
  // Returns null for game_id workspaces (no translation needed)
```

**Member translation (idempotent on prefix boundary):**
```typescript
export function physicalMember(member: string, prefix: string | null): string
  // 'mf_users.ltv_vnd' + 'cfm' → 'cfm_mf_users.ltv_vnd'
  // 'cfm_mf_users.ltv_vnd' + 'cfm' → 'cfm_mf_users.ltv_vnd' (no-op if already prefixed)

export function logicalMember(member: string, prefix: string | null): string
  // 'cfm_mf_users.ltv_vnd' + 'cfm' → 'mf_users.ltv_vnd'
```

**Query physicalization (entire query tree):**
```typescript
export function physicalizeQuery(query, prefix): Query
  // Rewrites measures, dimensions, timeDimensions, filters, order, segments
  // Used BEFORE hitting Cube on prefix workspaces (logical preset config → physical Cube members)

export function logicalizeRows(rows, prefix): unknown[]
  // Rewrites result row keys from physical → logical (cfm_mf_users.ltv → mf_users.ltv)
  // Used AFTER Cube responds on prefix workspaces
```

### Usage Pattern
**Caller never needs to know workspace model.** Example from segment flow:

```typescript
const workspace = req.workspace;  // { gameModel: 'prefix', gamePrefixMap: {...} }
const gameId = req.headers['x-cube-game'];

const prefix = resolveGamePrefix(workspace, gameId);  // 'cfm' or null
const physicalQuery = physicalizeQuery(logicalQuery, prefix);
const cubeResult = await cubeSdk.load(physicalQuery);
const logicalRows = logicalizeRows(cubeResult.data, prefix);
// Consumer sees logicalRows with 'mf_users.ltv' keys — unchanged from logical config
```

---

## 4. Views & Cross-Game Composition

### View Structure
**File:** `cube-dev/cube/model/views/{game}/`

Each game gets its own view copy:
```
views/
  cfm/
    user_360.yml          ← Single view file
  ballistar/
    user_360.yml          ← Different content (game-specific joins + dimensions)
  jus/
    user_360.yml
  ...
```

**Example (cfm/user_360.yml:1–60):**
- View references LOGICAL cube names: `mf_users`, `recharge`, etc.
- Joins are game-specific (cfm has 28 cubes, jus has 15)
- Loaded exclusively via `repositoryFactory` under that game's securityContext

### How Views Respect Game Scope
1. **Model loader filters by gameId** (cube.js:335–355)
   - CFM user gets `views/cfm/*.yml` only
   - Jus user gets `views/jus/*.yml` only
   - Cross-game view references 400 immediately
2. **Logical refs stay consistent**
   - FE config uses `mf_users` (logical)
   - On prefix workspaces, physicalization converts to `cfm_mf_users` at request boundary
   - View YAML never contains prefix (always logical names)

---

## 5. Workspace Configuration & Model Selection

### Config Files
**FE:** `gds.config.json:4–54` — Game registry (8 games, defaultGameId: ballistar)
**BE:** `workspaces.config.json` — Workspace registry

**Local (default):**
```json
{
  "id": "local",
  "gameModel": "game_id",  ← Cubes in game-specific folders
  "cubeApiUrl": "http://localhost:4000"
}
```

**Prod (role-gated, read-only):**
```json
{
  "id": "prod",
  "gameModel": "prefix",  ← Single schema, prefixed cube names
  "gamePrefixMap": {"cfm_vn": "cfm", "ballistar": "ballistar", ...},
  "allowedRoles": ["editor", "admin"]
}
```

### Token Minting & Game Enforcement
**File:** `server/src/middleware/workspace-header.ts:50–140`

**Per-request flow:**
1. Read `x-cube-workspace` header → resolve workspace by id (SSRF guard)
2. Read `x-cube-game` header → validate user can access this game (real-auth: fail-closed)
3. Mint JWT: `buildCtx(workspace, gameId, userId)` → token with `{ game: 'cfm', userId: '...', ... }`
4. Token scopes Cube's `/meta` introspection + query execution
   - On game_id workspaces: JWT game claim routes to the per-game folder
   - On prefix workspaces: JWT game claim unused (shared schema, prefix handles routing)

---

## 6. Per-Game Filter Edge Cases & Missing Coverage

### Games Available Across Models
```
game_id (local):
  ballistar, cfm_vn (alias → cfm), cros, jus_vn (alias → jus),
  muaw, pubg, ptg, tf
  (8 games, all 8 have some cubes)

prefix (prod):
  cfm_vn, ballistar, cros, jus_vn
  (4 games only — ptg, muaw, pubg, tf excluded from prod gamePrefixMap)
```

### Cube Coverage Per Game
| Game | Cubes | Folder | Prod Included? |
|------|-------|--------|----------------|
| ballistar | 10 | Yes | Yes |
| cfm | 28 | Yes | Yes (cfm_vn alias) |
| cros | 12 | Yes | Yes |
| jus | 15 | Yes | Yes (jus_vn alias) |
| muaw | 10 | Yes | No |
| ptg | 3 | Yes | No |
| pubg | 10 | Yes | No |
| tf | 12 | Yes | No |

**Implications:**
- Local dev can query all 8 games (game_id model, 8 folders)
- Prod (`prefix` model) gates only 4 games (fewer prefix mappings)
- Switching workspace filters game picker: prod hides ptg/muaw/pubg/tf entirely
- Readiness check (`/api/workspaces/{wsId}/games-readiness`) returns 200 with per-game status; unknown games → `"status": "missing"` → dropped from picker

### Readiness Probe
**File:** `server/src/services/workspace-readiness.ts`

- Calls Cube `/meta` for each game under the active workspace
- Returns game id + status ('ok', 'error', 'missing')
- FE narrows picker to `status: 'ok'` games only (fail-open: null response → pass-through, show all)
- Prevents 400 errors on game-missing queries

### Fallback Behavior on Game Switch
**File:** `src/components/Header/use-game-context.ts:259–265`

When switching workspace:
1. Active game may no longer be in `visibleGames` (filtered by workspace + grant + readiness)
2. Auto-falls back to `visibleGames[0].id` and persists
3. QueryBuilder re-mounts (key={gameId} on QueryTabs) → clean state, no stale query

---

## 7. How New Cross-Cutting Layers Inherit Per-Game Scoping

### Pattern for Monetization / Acquisition / Identity / CS Layers

To add a new layer (e.g., **monetization_cohort** metric), respect the workspace model:

**Option A: Shared across games (single cube, gameId dimension)**
```yaml
# cubes/cfm/monetization_cohort.yml (+ same in cubes/jus/, etc.)
measures:
  - name: tier_count
    type: count_distinct
    sql: user_id
dimensions:
  - name: game_id  # ← Explicit game dimension for game_id workspaces
  - name: tier
```

**Option B: Per-game prefixed (prefix model only)**
```yaml
# cubes/<NO FOLDER>/cfm_monetization_cohort.yml
# cubes/<NO FOLDER>/jus_monetization_cohort.yml
# (all cubes at one level, Cube routing via repositoryFactory based on Trino schema)
```

**Best Practice:** Follow existing pattern
- **Local (game_id):** Store at `cubes/{game}/` with gameId dimension (e.g., `cfm/monetization_cohort.yml`)
- **Prod (prefix):** Name-space at `cubes/` level with prefix (e.g., `cfm_monetization_cohort.yml`, `jus_monetization_cohort.yml`)
- **Physicalization:** Use `physicalMember()` when storing logical config server-side; `logicalizeRows()` when surfacing to FE
- **No hardcoding:** Never assume a game's Trino schema in YAML; rely on `cube.js` driver config + Cube's securityContext routing

### Segment/Metric Config Pattern
**File:** `server/src/routes/segment-cs-care.ts:51–52` — example of per-game metric reference

```typescript
const gameId = row.game_id ?? null;
// Query uses gameId to pick the right Cube token + endpoint
// Server stores logical refs ('mf_users.ltv'); physicalizes on prefix workspaces
```

---

## Unresolved Questions

1. **PTG cube count (3 cubes)**: Is PTG intentionally minimal, or are cubes planned but not yet added? Should future layers assume PTG has the same cubes as other games, or handle missing refs gracefully?

2. **Alias routing edge case**: `cfm_vn` and `jus_vn` are aliases (normalize to `cfm`, `jus` in Cube). Does RBAC grant list store aliases or canonical ids? (Current code suggests canonical, but worth verifying during auth system audit.)

3. **Prefix model expansion**: When prod adds new games (e.g., muaw, ptg), do existing queries auto-upgrade if they reference global metric names, or does literal cube name porting fail silently?

4. **View fallback**: If a game lacks a view file (e.g., a new game before views are onboarded), what does Cube return to `/meta/cubes` queries? Empty list or 404?

