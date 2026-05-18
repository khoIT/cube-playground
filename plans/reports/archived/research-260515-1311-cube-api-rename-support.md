# Research Report: Cube Backend Support for Rename / Delete / Edit Operations

**Conducted:** 2026-05-15
**Backend probed:** `ballistar_cube_api` container (cubejs/cube:latest, dev-mode), host `:4000`
**Schema source:** `/Users/lap16299/Documents/code/cube/packages/cubejs-server-core/src/core/DevServer.ts`
**Live model:** `/Users/lap16299/Documents/code/cube-dev/cube/model/` (4 cubes, 7 views)
**Scope:** Answer Q1 + Q2 from previous report (`research-260515-1254-ui-revamp-stitch-standalone-mockup.md`).

---

## Executive Summary

**Brutal verdict:** **Cube's dev-mode HTTP API does NOT support arbitrary file mutation.** No rename, no delete, no edit-as-write. The only two write endpoints are:

1. `POST /playground/generate-schema` — **destructive scaffold** (empties `cubes/` and `views/` then writes fresh files from DB introspection). Useless for a rename UX.
2. `POST /playground/schema/pre-aggregation` — appends a **single pre-aggregation** to an existing cube file. Too narrow for general edits.

Both routes also need the model directory mounted **read-write**, which it currently is **NOT** (`docker-compose.yml:27` — `:ro`). That's the EROFS error the user already saw when adding a rollup.

Renaming a cube also breaks every view that references it via `join_path:` — Cube has no API-level "rename + cascade" helper; the schema compiler will hard-fail at next reload.

**So the prior report's Feature A (cube/view rename via UI) is not feasible against vanilla Cube dev-mode.** Three paths forward, in order of pragmatism:

| Option | What it is | Effort | Verdict |
|---|---|---|---|
| **A** | Client-side alias-only rename (localStorage display name) | 1 day | ✅ KISS — recommended for v1. Filename and YAML untouched. |
| **B** | Sidecar Express service mounted on same RW volume, exposing `PUT/DELETE /api/files/:path` | 2-3 days | ⚠ Works but adds infra. Use if real file edits matter. |
| **C** | Patch Cube backend (PR upstream or fork) to add file CRUD | 1-2 weeks + sign-off | ❌ Not worth it for a playground frontend. |

Recommend **A**. It satisfies the user's UX ("change cube/views file name and icon") without infrastructure churn, defers the hard problem (cascade-update of views), and is fully reversible.

---

## Method

Three layers of evidence:

1. **Docker inspection** — confirms env + mount mode.
2. **Source read** — `DevServer.ts` registers every dev-mode HTTP route. Grep returns the full surface.
3. **Live probes** — `curl` against running `:4000` to verify what 404s vs 200s.

---

## Findings

### F1 — Container is dev-mode with read-only model volume

```
Container : ballistar_cube_api  (cubejs/cube:latest)
Env       : CUBEJS_DEV_MODE=true
            CUBEJS_SCHEMA_PATH=model
Mount     : /Users/lap16299/Documents/code/cube-dev/cube/model
            → /cube/conf/model  (ro)
```

Verified inside container:

```
$ docker exec ballistar_cube_api sh -c 'mount | grep model'
lima-1d48f49ab5e1bad8 on /cube/conf/model type virtiofs (ro,relatime)

$ docker exec ballistar_cube_api touch /cube/conf/model/test
touch: cannot touch '/cube/conf/model/test': Read-only file system
```

`docker-compose.yml:27` is the switch: `- ./cube/model:/cube/conf/model:ro` → flip to `:rw` to allow writes. User-side, no Cube change required.

### F2 — Dev-mode HTTP routes (complete inventory)

Source: `packages/cubejs-server-core/src/core/DevServer.ts`. Every route registered:

| # | Method | Path | Read/Write | Used by current frontend? |
|---|---|---|---|---|
| 1 | GET | `/playground/context` | R | ✓ (App.tsx bootstrap) |
| 2 | GET | `/playground/db-schema` | R | ✓ (Schema page) |
| 3 | GET | `/playground/files` | R | ✓ (IndexPage routing) |
| 4 | POST | `/playground/generate-schema` | **DESTRUCTIVE W** | Connection wizard (we dropped it) |
| 5 | GET | `/playground/dashboard-app-create-status` | R | dashboard-app (we don't use) |
| 6 | GET | `/playground/start-dashboard-app` | side-effect | dashboard-app |
| 7 | GET | `/playground/dashboard-app-status` | R | dashboard-app |
| 8 | GET | `/playground/driver` | R | driver wizard |
| 9 | POST | `/playground/driver` | W (env) | driver wizard |
| 10 | POST | `/playground/apply-template-packages` | W (npm) | dashboard-app |
| 11 | GET | `/playground/manifest` | R | template list |
| 12 | GET | `/playground/live-preview/start/:token` | side-effect | Cube Cloud sync (we don't use) |
| 13 | GET | `/playground/live-preview/stop` | side-effect | Cube Cloud sync |
| 14 | GET | `/playground/live-preview/status` | R | Cube Cloud sync |
| 15 | POST | `/playground/live-preview/token` | W | Cube Cloud sync |
| 16 | POST | `/playground/test-connection` | side-effect | connection wizard |
| 17 | POST | `/playground/env` | W (.env) | connection wizard |
| 18 | POST | `/playground/token` | side-effect (JWT mint) | ✓ (token modal) |
| 19 | POST | `/playground/schema/pre-aggregation` | **NARROW W** | ✓ (Rollup designer) |

**Conspicuously absent:**

- `PUT /playground/files/:path` — edit one file
- `POST /playground/files` (write multiple) — used to exist in older builds, removed
- `DELETE /playground/files/:path` — remove a file
- `POST /playground/rename` — rename
- Anything view-aware

### F3 — Live HTTP probes confirm 404 for write/delete

```
$ curl -X DELETE http://localhost:4000/playground/files/cubes/active_daily.yml
<!DOCTYPE html><html><head><title>Error</title>  -- Express default "Cannot DELETE"

$ curl -X PUT    http://localhost:4000/playground/files
<!DOCTYPE html>...  -- Express default "Cannot PUT"

$ curl -X POST   http://localhost:4000/playground/files -d '{}' -H 'content-type: application/json'
<!DOCTYPE html>...  -- Express default "Cannot POST"

$ curl -X OPTIONS http://localhost:4000/playground/files -i
HTTP/1.1 204 No Content
Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE   ← CORS lies; no PUT/DELETE handler exists
```

The CORS preflight advertises all methods (default `cors` middleware), but only `GET` is wired. **`Access-Control-Allow-Methods` is not a contract — actual routing wins.**

### F4 — `POST /playground/generate-schema` is destructive, not surgical

`DevServer.ts:161-225` (excerpted):

```javascript
await fs.emptyDir(path.join(options.schemaPath, 'cubes'));
await fs.emptyDir(path.join(options.schemaPath, 'views'));
await fs.writeFile(path.join(options.schemaPath, 'views', 'example_view.yml'), `...`);
await Promise.all(files.map(file =>
  fs.writeFile(path.join(options.schemaPath, 'cubes', file.fileName), file.content)
));
```

It **empties both `cubes/` and `views/` directories** before writing. Calling it to "create one new file" wipes everything. Cannot be repurposed for rename.

### F5 — `POST /playground/schema/pre-aggregation` is the only surgical writer

`DevServer.ts:616-649`. Behaviour:

1. Take `{ cubeName, preAggregationName, code }`.
2. Locate the *existing* cube file owning `cubeName`.
3. Insert the pre-agg block (JS or YAML) into the file.
4. Write the file back via `repository.writeDataSchemaFile(...)`.

Notable limits:
- Only adds pre-aggregations; cannot edit measures/dimensions/joins.
- Returns 400 if the file is a templated YAML (Jinja) — explicit guard at `:644`.
- Requires RW filesystem.

This is the EROFS spot the user already hit. With current `:ro` mount, the response will be `EROFS: read-only file system, open '/cube/conf/model/cubes/active_daily.yml'`.

### F6 — Views reference cubes by name; rename = breakage

Real example from this repo: `views/user_360.yml` defines 7 views, all referencing cubes via `join_path: <cube_name>`. Tally:

```
user_profile             → join_path: mf_users
user_activity_timeline   → join_path: active_daily
user_recharge_timeline   → join_path: user_recharge_daily
user_transactions        → join_path: recharge
user_audience            → join_path: mf_users
revenue_metrics          → join_path: recharge
activity_metrics         → join_path: active_daily
```

If we renamed cube `active_daily` → `daily_users`:
- 2 views immediately break (`user_activity_timeline`, `activity_metrics`).
- Schema compile fails on next refresh.
- `GET /cubejs-api/v1/meta` returns 500.
- All running queries against the broken views fail.

Cube's compiler resolves `join_path` at compile time only. There is no API to discover backreferences (which views point at a given cube). To do safe rename we would need to:

1. Read all files via `GET /playground/files`.
2. Parse the YAML / JS ourselves to extract every `join_path:` and `joins:` reference.
3. Build an inverse index `{cubeName → [{viewFile, lineNo}]}`.
4. Show user a "this rename will affect N views" confirmation.
5. Atomic-write all affected files + the cube file in one transaction (which the API doesn't support — best-effort sequential writes only).

**That's a lot of client-side work to compensate for missing server features.** Reinforces Option A (alias-only) for v1.

### F7 — Meta does NOT leak underlying cube names for views

```
$ curl :4000/cubejs-api/v1/meta | jq '.cubes[] | select(.type=="view")'
{
  "name": "user_profile",
  "type": "view",
  "measures": [...],
  "dimensions": [...]
  // no join_path, no underlying cube list
}
```

Views are opaque post-compile. Sidebar UI cannot derive view→cube dependencies from the API. Would need to fetch + parse raw YAML via `/playground/files` (which works in dev mode).

---

## Updated Answers to the Two Questions

### Q1 — "Does Cube dev-mode expose `DELETE /playground/files/:path`?"

**No.** Confirmed by source read and live probe. The only file mutator is `POST /playground/schema/pre-aggregation` (limited scope) and `POST /playground/generate-schema` (destructive). Additionally, the current container mounts the model volume **read-only**, so even those endpoints would fail.

**Therefore "rename file" cannot ship as a backend-backed feature without:**
- (a) Flipping `:ro` → `:rw` in `docker-compose.yml`, AND
- (b) Adding sidecar / patching Cube to introduce the missing routes, OR
- (c) Choosing client-side alias-only rename.

### Q2 — "Renaming a cube breaks views — cascade or block?"

**Block** (or guard with explicit warning). Cube has zero cascade support; view→cube references are resolved at compile time and break silently from the API's perspective until next schema refresh.

If we *must* implement cascade in the client, F6 sketches the required steps. Net assessment: **~3 days of YAML/JS parser work**, and even then we'd be racing the file system (no transactional write).

---

## Revised Recommendation for Feature A (Rename + Icon)

### Option A — alias-only, ship in v1

```typescript
// src/hooks/use-cube-alias.ts
const STORAGE_KEY = 'gds-cube:cube-aliases';
type Aliases = Record<string, { displayName?: string; icon?: string }>;

export function useCubeAlias(cubeName: string) {
  const [aliases, setAliases] = useState<Aliases>(() =>
    JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  );
  const set = (patch: { displayName?: string; icon?: string }) => {
    const next = { ...aliases, [cubeName]: { ...aliases[cubeName], ...patch } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setAliases(next);
  };
  return [aliases[cubeName] ?? {}, set] as const;
}
```

What the user sees:
- Cube tree shows `aliases[name].displayName ?? meta.cube.title ?? meta.cube.name`.
- Icon picker (lucide-react) writes `aliases[name].icon`.
- Original file unchanged. Underlying cube name (`active_daily`) still works in queries.
- Survives page reload. Per-browser (not synced across devices — acceptable trade for "playground" tooling).

**Trade-off documented:** rename is display-only; the actual schema name in SQL / JSON queries is the YAML `name:`, not the alias. Power users will eventually notice.

### Option B — sidecar service, defer to v2

A 100-LOC Express sidecar with the same volume mount:

```javascript
// schema-editor/server.js (sketch)
app.put('/api/files/:path(*)', (req, res) => fs.writeFile(`/model/${req.params.path}`, req.body.content, ok(res)));
app.delete('/api/files/:path(*)', (req, res) => fs.unlink(`/model/${req.params.path}`, ok(res)));
app.post('/api/rename', (req, res) => fs.rename(`/model/${req.body.from}`, `/model/${req.body.to}`, ok(res)));
```

Mount the same host dir RW into both `ballistar_cube_api` AND the sidecar. Vite proxies `/schema-editor/*` to the sidecar.

Cost: maintain a second service, deal with auth, deal with cascade-rename logic in the sidecar (or push it to client). **Defer unless v1 alias-rename proves insufficient.**

---

## Risks Flagged

| # | Risk | Note |
|---|---|---|
| R1 | localStorage alias drift — same cube renamed by 2 users sees 2 different names | Acceptable for a 1-user playground. Document. |
| R2 | If user later flips `:rw` and uses Option B, alias map becomes stale | Add a "promote alias to real rename" action in v2 |
| R3 | Backend API surface is documented from `DevServer.ts` HEAD; Cube `latest` tag may differ. | Cross-verified: container image `cubejs/cube:latest` against the local `cube` checkout; routes match. |

---

## Unresolved Questions

1. **Is "alias only" enough for the user?** Or do they specifically need the YAML filename to change (e.g. for git history / readability)? If yes, Option B becomes mandatory.
2. **Should the icon picker be free-text (any lucide name) or a curated set?** Free-text is simpler; curated is more polished. KISS → free-text.
3. **Do we need to expose the underlying real cube name somewhere in UI** (e.g. small monospace label below the alias)? Recommend yes — so users don't lose the mapping when writing manual queries.
4. **Does the user want to keep the icon picker scoped to cubes, or also to views?** Views in our meta are 7 user-facing surfaces — they probably want icons too.
5. **If the user later flips `docker-compose.yml` to `:rw`, do they want the rollup designer to "just work"?** No code change needed in our app — it'll work as soon as the FS allows writes. Just a docs note.

---

## Appendix — Verbatim Cube Source Excerpts

`DevServer.ts:150-159` — files reader (read-only):
```typescript
app.get('/playground/files', catchErrors(async (req, res) => {
  this.cubejsServer.event('Dev Server Files Load');
  const files = await this.cubejsServer.repository.dataSchemaFiles();
  res.json({
    files: files.map(f => ({
      ...f,
      absPath: path.resolve(path.join(this.cubejsServer.repository.localPath(), f.fileName))
    }))
  });
}));
```

`DevServer.ts:191-223` — generate-schema (destructive):
```typescript
await fs.emptyDir(path.join(options.schemaPath, 'cubes'));
await fs.emptyDir(path.join(options.schemaPath, 'views'));
await fs.writeFile(path.join(options.schemaPath, 'views', 'example_view.yml'), `# ...templated comment...`);
await Promise.all(files.map(file =>
  fs.writeFile(path.join(options.schemaPath, 'cubes', file.fileName), file.content)
));
```

`DevServer.ts:616-648` — pre-agg writer (surgical):
```typescript
app.post('/playground/schema/pre-aggregation', catchErrors(async (req, res) => {
  const { cubeName, preAggregationName, code } = req.body;
  const schemaConverter = new CubeSchemaConverter(this.cubejsServer.repository, [
    new CubePreAggregationConverter({ cubeName, preAggregationName, code })
  ]);
  try { await schemaConverter.generate(cubeName); }
  catch (error) { return res.status(400).json({ error: (error as Error).message || error }); }
  const file = schemaConverter.getSourceFiles().find(...);
  if (!file) return res.status(400).json({ error: `The schema file for "${cubeName}" cube was not found...` });
  this.cubejsServer.repository.writeDataSchemaFile(file.fileName, file.source);
  return res.json('ok');
}));
```
