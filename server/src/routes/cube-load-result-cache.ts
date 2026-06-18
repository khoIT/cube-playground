/**
 * Short-lived RESULT cache for the `/cube-api/v1/load` proxy path.
 *
 * The in-flight dedup in cube-load-admission only coalesces CONCURRENT identical
 * queries — two users opening the same dashboard 30s apart each still hit
 * Cube/Trino. Game analytics data is overwhelmingly daily-grained, so a
 * completed result stays correct for minutes. Caching it lets staggered users on
 * /build, /segments, and /ops (and the chat-service, which posts to the same
 * proxy) reuse one warehouse round-trip instead of N — the main throughput lever
 * for "many users, same query".
 *
 * Tenancy: the cache key is the same workspace|game|method|query the dedup key
 * already uses — game-scoped, NOT user-scoped. That is the correct sharing
 * boundary today (users within a game are one tenant; Cube itself caches
 * per-game, never per-user). CAVEAT (mirrors chat-service's load cache): there
 * is NO ownerId in the key. Safe while all traffic runs under a single owner;
 * when per-user row-level scoping lands the key MUST gain ownerId or this cache
 * MUST be disabled, or one user could be served another user's rows.
 *
 * What is cached: only a complete, successful, NON-EMPTY result (HTTP 200, no
 * error body, at least one row). Empty results are skipped on purpose — a
 * transient "no data yet" must not freeze for the whole TTL. Cube's warming
 * signal (200 + "Continue wait", no rows) is naturally excluded by the same
 * has-rows gate. Realtime cubes bypass entirely (see isRealtimeQuery).
 */

export type CachedLoadResult = { status: number; body: unknown };

// Read knobs at call time so deployments (and tests) can retune without a
// rebuild. Default TTL 10 min — matches the chat-service load cache and the
// daily grain of the data. Set CUBE_LOAD_RESULT_CACHE_ENABLED=false to disable.
function ttlMs(): number {
  return Number(process.env.CUBE_LOAD_RESULT_CACHE_TTL_MS) || 600_000;
}
function enabled(): boolean {
  return (process.env.CUBE_LOAD_RESULT_CACHE_ENABLED ?? 'true') !== 'false';
}
// Bound memory: each entry holds one query's full result body. Oldest evicted
// on overflow (insertion-order Map → cheap LRU-ish recency on get()).
function maxEntries(): number {
  return Number(process.env.CUBE_LOAD_RESULT_CACHE_MAX_ENTRIES) || 500;
}

interface Entry {
  result: CachedLoadResult;
  expiresAt: number;
}

const store = new Map<string, Entry>();

// Injectable clock so TTL expiry is testable without real time.
let clock: () => number = () => Date.now();

/**
 * A Cube /load body carries rows either as `{ data: [...] }` (single query) or
 * `{ results: [{ data: [...] }] }` (queryType=multi, used by the SDK GET path).
 * Returns true only when at least one row is present and there is no error —
 * which also rejects the "Continue wait" warming body (it has an `error` field
 * and no rows).
 */
export function loadResultHasRows(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as { error?: unknown; data?: unknown; results?: unknown };
  if (b.error != null) return false;
  if (Array.isArray(b.data)) return b.data.length > 0;
  if (Array.isArray(b.results)) {
    return (b.results as Array<{ data?: unknown }>).some(
      (r) => Array.isArray(r?.data) && r.data.length > 0,
    );
  }
  return false;
}

/** A result is cacheable when it is a successful, non-empty 200. */
export function isCacheableResult(result: CachedLoadResult): boolean {
  return result.status === 200 && loadResultHasRows(result.body);
}

/**
 * Realtime cubes (…_realtime: payment_delivery_realtime,
 * active_performance_realtime, …) are meant to reflect live state — they must
 * never be served from cache. Scans the query shape for a member naming a
 * realtime cube. A stray match on a filter value only causes a cache BYPASS
 * (a fresh query), never a wrong-data hit, so the broad scan is safe.
 */
export function isRealtimeQuery(queryShape: unknown): boolean {
  let found = false;
  const scan = (v: unknown): void => {
    if (found) return;
    if (typeof v === 'string') {
      if (/realtime/i.test(v)) found = true;
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(scan);
      return;
    }
    if (v && typeof v === 'object') {
      Object.values(v as Record<string, unknown>).forEach(scan);
    }
  };
  scan(queryShape);
  return found;
}

/** Fresh cached result for `key`, or null on miss/expiry/disabled. */
export function getCachedLoad(key: string): CachedLoadResult | null {
  if (!enabled()) return null;
  const e = store.get(key);
  if (!e) return null;
  if (clock() >= e.expiresAt) {
    store.delete(key);
    return null;
  }
  // Refresh recency so hot entries survive eviction.
  store.delete(key);
  store.set(key, e);
  return e.result;
}

/** Store a result under `key` if it is cacheable. No-op otherwise. */
export function putCachedLoad(key: string, result: CachedLoadResult): void {
  if (!enabled()) return;
  if (!isCacheableResult(result)) return;
  const cap = maxEntries();
  if (store.size >= cap && !store.has(key)) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { result, expiresAt: clock() + ttlMs() });
}

/** Observability snapshot for admin/telemetry surfaces. */
export function resultCacheSnapshot(): { enabled: boolean; size: number; ttlMs: number } {
  return { enabled: enabled(), size: store.size, ttlMs: ttlMs() };
}

/** Test-only: control time. */
export function __setClockForTest(fn: () => number): void {
  clock = fn;
}
/** Test-only: reset module state between cases. */
export function __resetResultCacheForTest(): void {
  store.clear();
  clock = () => Date.now();
}
