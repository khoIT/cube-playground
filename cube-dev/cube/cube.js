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

// Where the model files live inside the container. Each tenant loads only its
// own subdir, so cube definitions never leak across games.
const MODEL_ROOT = process.env.CUBEJS_MODEL_ROOT || '/cube/conf/model';

// Game key (used in JWT + URLs) -> Trino schema under the game_integration catalog.
// Schema names are stable and live in Trino; only this map ever needs to grow.
const GAME_SCHEMA = {
  ballistar: 'ballistar_vn',
  cfm:       'cfm_vn',
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
    if (!access.allowedGames.includes(game)) {
      throw new Error(`User ${payload.userId} not allowed for game ${payload.game}`);
    }
    req.securityContext = buildSecurityContext({ ...payload, game }, access);
  },

  // 2. Per-tenant compile cache. Cube keeps one compiled schema per appId,
  //    so changes in one tenant's metadata don't invalidate the others.
  contextToAppId: ({ securityContext }) =>
    `cube_${gameFor(securityContext)}`,

  // 3. Per-tenant orchestrator. Pre-aggregation storage in Cube Store is
  //    keyed by orchestratorId, so each game gets its own rollup namespace.
  contextToOrchestratorId: ({ securityContext }) =>
    `orch_${gameFor(securityContext)}`,

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
  scheduledRefreshContexts: async () =>
    SUPPORTED_GAMES.map((game) => ({
      securityContext: {
        userId:       `refresh:${game}`,
        game,
        allowedGames: [game],
        roles:        [REFRESH_ROLE],
      },
    })),

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
  queryRewrite: (query, _ctx) => query,
};
