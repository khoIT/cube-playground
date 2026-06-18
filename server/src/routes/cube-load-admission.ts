/**
 * Admission control for the `/cube-api/v1/load` proxy path.
 *
 * Raising the per-query wait budget to ~110s means a slow query now occupies
 * its Cube orchestrator slot + Trino connection ~4x longer than the old 30s.
 * Cube serves from a single prod instance with a default ~10 orchestrator
 * concurrency against a SHARED Trino cluster, and the frontend cannot cancel
 * in-flight queries (SDK lacks AbortSignal). Without a policy, one click-happy
 * user opening many heavy artifacts can saturate the instance and starve other
 * users, the chat agent, and pre-agg refresh.
 *
 * This module bounds the blast radius with three mechanisms, all applied only
 * to leader (distinct) upstream queries — followers are free:
 *   1. Per-actor + global in-flight caps on distinct upstream /load queries.
 *      Over cap → reject (the route maps this to HTTP 429 + Retry-After).
 *   2. In-flight dedup: identical concurrent queries (same actor scope + shape)
 *      share ONE upstream call instead of each hitting Cube/Trino.
 *   3. Disconnect-aware abort: each interested client increments a refcount;
 *      when the last one disconnects the shared upstream is aborted, freeing
 *      Cube/Trino immediately rather than running to the full budget orphaned.
 */

// Max distinct in-flight upstream /load queries a single actor may hold — a
// runaway guard, NOT a throughput throttle. Dedup'd identical queries and
// disconnected clients don't count, so it bites only on genuine pile-up across
// surfaces by one click-happy user. Generous on purpose; raise via env.
const MAX_INFLIGHT_PER_OWNER = Number(process.env.CUBE_LOAD_MAX_INFLIGHT_PER_OWNER) || 8;
// Max distinct in-flight upstream /load queries across all actors. Kept ==
// Cube's orchestrator concurrency (CUBEJS_CONCURRENCY, prod default 24) so the
// proxy backpressures one notch before Cube's own queue — it is NOT the
// throughput ceiling (that's CUBEJS_CONCURRENCY + the Trino pool). Raise this,
// CUBEJS_CONCURRENCY, and CUBEJS_DB_MAX_POOL together when scaling the box.
const MAX_INFLIGHT_GLOBAL = Number(process.env.CUBE_LOAD_MAX_INFLIGHT_GLOBAL) || 24;

export type LoadResult = { status: number; body: unknown };

/** Thrown when admission caps are exceeded; the route maps it to a 429. */
export class LoadAdmissionRejected extends Error {
  constructor(public readonly scope: 'owner' | 'global') {
    super(`Cube /load admission rejected (${scope} concurrency cap reached)`);
    this.name = 'LoadAdmissionRejected';
  }
}

interface InflightEntry {
  refcount: number;
  controller: AbortController;
  promise: Promise<LoadResult>;
  ownerId: string;
}

let globalInFlight = 0;
const ownerInFlight = new Map<string, number>();
const inflight = new Map<string, InflightEntry>();

function incOwner(ownerId: string): void {
  ownerInFlight.set(ownerId, (ownerInFlight.get(ownerId) ?? 0) + 1);
}
function decOwner(ownerId: string): void {
  const n = (ownerInFlight.get(ownerId) ?? 0) - 1;
  if (n <= 0) ownerInFlight.delete(ownerId);
  else ownerInFlight.set(ownerId, n);
}

/** Run `cb` when the signal aborts — immediately if it already has. */
function onAbort(signal: AbortSignal, cb: () => void): void {
  if (signal.aborted) cb();
  else signal.addEventListener('abort', cb, { once: true });
}

/**
 * Admit a /load query through the concurrency + dedup policy.
 *
 * - `clientSignal` aborts when the requesting client disconnects.
 * - `run` performs the actual upstream forward; it receives an abort signal
 *   that fires when ALL interested clients have disconnected.
 *
 * Followers (a matching in-flight query) join the shared upstream without
 * consuming a slot, so dedup never trips the caps. Throws LoadAdmissionRejected
 * when this would be a NEW upstream query and a cap is already reached.
 */
export function admitLoad(opts: {
  ownerId: string;
  dedupKey: string;
  clientSignal: AbortSignal;
  run: (upstreamSignal: AbortSignal) => Promise<LoadResult>;
}): Promise<LoadResult> {
  const { ownerId, dedupKey, clientSignal, run } = opts;

  // Follower: join the in-flight upstream. No slot consumed.
  const existing = inflight.get(dedupKey);
  if (existing) {
    existing.refcount++;
    onAbort(clientSignal, () => {
      if (--existing.refcount <= 0) existing.controller.abort();
    });
    return existing.promise;
  }

  // Leader: enforce caps before starting a new upstream query.
  if (globalInFlight >= MAX_INFLIGHT_GLOBAL) throw new LoadAdmissionRejected('global');
  if ((ownerInFlight.get(ownerId) ?? 0) >= MAX_INFLIGHT_PER_OWNER) {
    throw new LoadAdmissionRejected('owner');
  }

  const controller = new AbortController();
  globalInFlight++;
  incOwner(ownerId);
  const entry: InflightEntry = {
    refcount: 1,
    controller,
    ownerId,
    // Bound the upstream by the all-clients-gone signal AND its own timeout
    // (enforced inside `run`). finally() releases the slot + clears dedup.
    promise: run(controller.signal).finally(() => {
      globalInFlight--;
      decOwner(ownerId);
      inflight.delete(dedupKey);
    }),
  };
  inflight.set(dedupKey, entry);
  onAbort(clientSignal, () => {
    if (--entry.refcount <= 0) entry.controller.abort();
  });
  return entry.promise;
}

/** Snapshot of current admission state — for the /load route 429 telemetry. */
export function admissionSnapshot(): {
  globalInFlight: number;
  distinctInflight: number;
  maxGlobal: number;
  maxPerOwner: number;
} {
  return {
    globalInFlight,
    distinctInflight: inflight.size,
    maxGlobal: MAX_INFLIGHT_GLOBAL,
    maxPerOwner: MAX_INFLIGHT_PER_OWNER,
  };
}

/** Test-only: reset module state between cases. */
export function __resetAdmissionForTest(): void {
  globalInFlight = 0;
  ownerInFlight.clear();
  inflight.clear();
}
