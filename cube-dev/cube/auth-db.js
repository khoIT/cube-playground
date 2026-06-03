// Auth DB lookup module.
//
// `getUserAccess(userId)` returns the games + roles a user may use. `userId` is
// the stable key minted into the Cube JWT by the playground — its lowercased
// email. Resolution order:
//
//   1. Internal API (preferred for prod): when AUTH_API_URL is set, query the
//      playground's shared authz source (`GET /internal/access/:key`, guarded by
//      AUTH_INTERNAL_SECRET). Results are cached for a short TTL to bound cost.
//      FAIL CLOSED — on any API error or non-200 we deny (throw), never fall
//      back to all-games.
//   2. File fallback (local dev): when AUTH_API_URL is unset, read the mounted
//      auth-users.json keyed by userId. Lets the stack run without the prod API.

const fs = require('fs');

const USERS_FILE = process.env.AUTH_USERS_FILE || '/cube/conf/auth-users.json';
const AUTH_API_URL = (process.env.AUTH_API_URL || '').replace(/\/+$/, '');
const AUTH_INTERNAL_SECRET = process.env.AUTH_INTERNAL_SECRET || '';
const CACHE_TTL_MS = Number(process.env.AUTH_CACHE_TTL_MS || 60000);
const API_TIMEOUT_MS = Number(process.env.AUTH_API_TIMEOUT_MS || 3000);

// ---- file fallback (local dev) --------------------------------------------

let fileCache = { mtimeMs: 0, users: null };

function loadUsersFile() {
  const stat = fs.statSync(USERS_FILE);
  if (stat.mtimeMs !== fileCache.mtimeMs) {
    fileCache = { mtimeMs: stat.mtimeMs, users: JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) };
  }
  return fileCache.users;
}

function getFromFile(userId) {
  const user = loadUsersFile()[String(userId)];
  if (!user) throw new Error(`Unknown user ${userId}`);
  return { allowedGames: user.allowedGames || [], roles: user.roles || [] };
}

// ---- internal API path (prod) ---------------------------------------------

// TTL cache: key -> { value, expiresAt }. Bounds per-request lookup cost
// (README hardening item).
const apiCache = new Map();

async function getFromApi(userId) {
  const key = String(userId).trim().toLowerCase();
  const now = Date.now();
  const hit = apiCache.get(key);
  if (hit && hit.expiresAt > now) {
    if (hit.error) throw new Error(hit.error);
    return hit.value;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${AUTH_API_URL}/internal/access/${encodeURIComponent(key)}`, {
      headers: { 'x-internal-secret': AUTH_INTERNAL_SECRET },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) {
    // Known-absent → cache the denial briefly and fail closed.
    apiCache.set(key, { error: `Unknown user ${key}`, expiresAt: now + CACHE_TTL_MS });
    throw new Error(`Unknown user ${key}`);
  }
  if (!res.ok) {
    // Transient/config error → fail closed, do NOT cache (retry next request).
    throw new Error(`auth API ${res.status}`);
  }
  const body = await res.json();
  const value = {
    allowedGames: Array.isArray(body.allowedGames) ? body.allowedGames : [],
    roles: body.role ? [body.role] : Array.isArray(body.roles) ? body.roles : [],
  };
  apiCache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

async function getUserAccess(userId) {
  if (AUTH_API_URL) return getFromApi(userId);
  return getFromFile(userId);
}

module.exports = { getUserAccess };
