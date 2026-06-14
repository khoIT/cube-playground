// Multi-tenant Cube config for the game_integration Trino catalog.
//
// Each request carries a JWT identifying the calling user and the game they
// want to query. We resolve the user's allowed games against the auth DB,
// reject cross-tenant access, then route the request to the correct Trino
// schema. Compile cache and pre-aggregation storage are namespaced per game.
//
// JWT shape (HS256, signed with CUBEJS_API_SECRET):
//   { userId: <number|string>, game: "ballistar"|"cfm"|"ptg"|"jus"|"muaw"|"pubg", iat: ... }

const fs   = require('fs');
const path = require('path');
const jwt  = require('jsonwebtoken');
const { getUserAccess } = require('./auth-db');
// Behavior / high-volume scan guardrail — pure, unit-tested logic lives in its
// own module so it can be exercised without the request/auth machinery.
const { enforceBehaviorBounds } = require('./behavior-bounds-guard.cjs');

// Where the model files live inside the container. Each tenant loads only its
// own subdir, so cube definitions never leak across games.
const MODEL_ROOT = process.env.CUBEJS_MODEL_ROOT || '/cube/conf/model';

// Game key (used in JWT + URLs) -> Trino schema under the game_integration catalog.
// Schema names are stable and live in Trino; only this map ever needs to grow.
const GAME_SCHEMA = {
  ballistar: 'ballistar_vn',
  cfm:       'cfm_vn',
  cros:      'cros',
  tf:        'tf',
  ptg:       'ptg',
  jus:       'jus_vn',
  muaw:      'muaw',
  pubg:      'pubgm',
};

const SUPPORTED_GAMES = Object.keys(GAME_SCHEMA);

// Frontend / external callers occasionally use legacy game ids with a
// country suffix (e.g. `cfm_vn`, `jus_vn`). We accept those as aliases of
// the canonical key in GAME_SCHEMA so JWT payloads minted with either form
// resolve to the same tenant. Aliases never bypass `getUserAccess` —
// `allowedGames` checks happen against the canonical id post-alias.
const GAME_ALIASES = {
  cfm_vn: 'cfm',
  jus_vn: 'jus',
  ballistar_vn: 'ballistar',
};

function canonicalGame(game) {
  if (!game) return game;
  return GAME_ALIASES[game] || game;
}

// Synthetic context used by the scheduled refresh worker. It bypasses the
// JWT path entirely, so we tag it with a sentinel role that queryRewrite
// (and future accessPolicy rules) can recognise as "system, not human".
const REFRESH_ROLE = '__refresh__';

// In dev mode (CUBEJS_DEV_MODE=true) Cube bypasses checkAuth, so the
// downstream hooks receive an empty securityContext. We fall back to a
// configurable default game so the Playground / SQL API stay usable without
// minting a JWT for every request. Production runs with dev mode off, so
// checkAuth always populates securityContext.game and this fallback is unused.
function gameFor(securityContext) {
  return canonicalGame(
    (securityContext && securityContext.game) ||
      process.env.CUBEJS_DEFAULT_GAME ||
      'ballistar',
  );
}

function buildSecurityContext(payload, access) {
  return {
    userId:       payload.userId,
    game:         payload.game,
    allowedGames: access.allowedGames,
    roles:        access.roles,
  };
}

module.exports = {
  // Hold /v1/load up to 25s before "Continue wait" so a single blocking request
  // returns data for any query finishing under ~25s (raw Trino scans run 6-10s).
  // Below the gateway's 120s upstream timeout.
  orchestratorOptions: {
    continueWaitTimeout: 25,
  },
  // 1. Authenticate every incoming request: verify JWT, resolve access from
  //    the auth DB, enforce that the requested game is allowed for this user.
  //
  //    Dev mode (CUBEJS_DEV_MODE=true) is permissive: a missing header, the
  //    bare API secret (Playground default), or a JWT with no game claim all
  //    resolve to an anonymous context. Downstream hooks then use the default
  //    game from gameFor(). Production runs with dev mode off and is strict.
  checkAuth: async (req, auth) => {
    const isDev = process.env.CUBEJS_DEV_MODE === 'true';

    if (!auth) {
      if (isDev) { req.securityContext = {}; return; }
      throw new Error('Authorization header missing');
    }

    let payload;
    try {
      payload = jwt.verify(auth, process.env.CUBEJS_API_SECRET);
    } catch (e) {
      if (isDev) { req.securityContext = {}; return; }
      throw e;
    }

    if (!payload.game) {
      if (isDev) { req.securityContext = {}; return; }
      throw new Error('Missing game claim');
    }
    // Normalize legacy aliases (e.g. cfm_vn → cfm) before validation so the
    // SUPPORTED_GAMES / allowedGames checks all key off canonical ids.
    const game = canonicalGame(payload.game);
    if (!SUPPORTED_GAMES.includes(game)) {
      throw new Error(`Unknown game claim: ${payload.game}`);
    }
    const access = await getUserAccess(payload.userId);
    // '*' is the all-games wildcard the internal auth bridge returns for an
    // admin / break-glass principal (when authz is disabled). Expand it to the
    // concrete supported-game ids so the membership check below — and every
    // downstream allowedGames consumer (security context, future RLS) — sees
    // real tenant ids, never the raw sentinel. A real RBAC grant lists its
    // games explicitly and never contains '*', so this is a no-op for it.
    if (access.allowedGames.includes('*')) {
      access.allowedGames = SUPPORTED_GAMES;
    }
    if (!access.allowedGames.includes(game)) {
      throw new Error(`User ${payload.userId} not allowed for game ${payload.game}`);
    }
    req.securityContext = buildSecurityContext({ ...payload, game }, access);
  },

  // 2. Per-tenant compile cache. Cube keeps one compiled schema per appId,
  //    so changes in one tenant's metadata don't invalidate the others.
  contextToAppId: ({ securityContext }) =>
    `cube_${gameFor(securityContext)}`,

  // 3. Per-tenant orchestrator. Isolates each game's query queues and
  //    refresh scheduling state.
  contextToOrchestratorId: ({ securityContext }) =>
    `orch_${gameFor(securityContext)}`,

  // 3b. Per-tenant pre-aggregation schema in Cube Store. orchestratorId does
  //     NOT namespace rollup tables — table identity is the pre-agg name plus
  //     a hash of the compiled loadSql, and because every game's YAML is
  //     identical text with bare sql_table values (the Trino schema only
  //     exists in the driver connection, never in the SQL), tenants compile
  //     byte-identical loadSql and collide on the SAME table in a shared
  //     schema. Whichever game the refresh worker builds first wins and every
  //     other game silently reads its data. A per-game schema makes the
  //     collision impossible.
  preAggregationsSchema: ({ securityContext }) =>
    `preagg_${gameFor(securityContext)}`,

  // 4. Per-tenant Trino driver. Same catalog, swap the schema. Existing
  //    cube YAMLs use bare sql_table values, so this is the only place the
  //    schema name appears in code paths.
  driverFactory: ({ securityContext }) => ({
    type:    'trino',
    host:    process.env.CUBEJS_DB_HOST,
    port:    process.env.CUBEJS_DB_PORT,
    user:    process.env.CUBEJS_DB_USER,
    password: process.env.CUBEJS_DB_PASS,
    catalog: process.env.CUBEJS_DB_PRESTO_CATALOG,
    schema:  GAME_SCHEMA[gameFor(securityContext)],
    ssl:     process.env.CUBEJS_DB_SSL === 'true',
  }),

  // 5. Refresh worker must enumerate every tenant or it only ever refreshes
  //    the first one it sees. We mint synthetic contexts (no JWT, all games
  //    allowed to self) tagged with REFRESH_ROLE so RLS rules can skip them.
  //    CUBE_REFRESH_GAMES (optional, comma-separated) scopes the sweep to a
  //    subset of games — used by the manual build trigger to seal one game's
  //    rollups without re-grinding all tenants. Unset = every supported game.
  scheduledRefreshContexts: async () => {
    const only = (process.env.CUBE_REFRESH_GAMES || '')
      .split(',').map((s) => canonicalGame(s.trim())).filter(Boolean);
    const games = only.length
      ? SUPPORTED_GAMES.filter((g) => only.includes(g))
      : SUPPORTED_GAMES;
    return games.map((game) => ({
      securityContext: {
        userId:       `refresh:${game}`,
        game,
        allowedGames: [game],
        roles:        [REFRESH_ROLE],
      },
    }));
  },

  // 6. Per-tenant model loader. Each game has its own subdir under
  //    model/cubes/<game>/ and model/views/<game>/. We read both at request
  //    time so adding a game = creating dirs + dropping YAML in, no code change.
  //    Missing dirs are tolerated (a game without views just returns no view files).
  repositoryFactory: ({ securityContext }) => ({
    dataSchemaFiles: async () => {
      const game = gameFor(securityContext);
      const files = [];
      for (const kind of ['cubes', 'views']) {
        const dir = path.join(MODEL_ROOT, kind, game);
        let names;
        try {
          names = await fs.promises.readdir(dir);
        } catch (e) {
          if (e.code === 'ENOENT') continue;
          throw e;
        }
        for (const name of names.filter((n) => n.endsWith('.yml') || n.endsWith('.yaml') || n.endsWith('.js'))) {
          const content = await fs.promises.readFile(path.join(dir, name), 'utf8');
          files.push({ fileName: `${kind}/${game}/${name}`, content });
        }
      }
      return files;
    },
  }),

  // 7. RLS extension point. Today this is a pass-through; per-user / per-role
  //    row filters get added here as the auth DB grows. Pattern:
  //
  //      if (!securityContext.roles.includes('admin')) {
  //        query.filters.push({
  //          member: 'recharge.user_id',
  //          operator: 'equals',
  //          values: [String(securityContext.userId)],
  //        });
  //      }
  queryRewrite: (query, _ctx) => {
    enforceBehaviorBounds(query);
    return query;
  },
};
