/**
 * Pre-aggregation run collector — orchestrates one pass per interval.
 *
 * Env gates:
 *   PREAGG_COLLECTOR_ENABLED=true   — must be set explicitly; off by default
 *                                     so prod/CI are unaffected until opted in
 *   PREAGG_COLLECTOR_INTERVAL_MS    — poll interval in ms (default 300 000 = 5m)
 *   PREAGG_WORKER_CONTAINER         — Docker container name for the refresh worker
 *
 * One pass:
 *   a) Read Docker logs since last cursor via docker-log-reader
 *      → If reader throws (socket absent / container unreachable): degraded mode,
 *        no log failures for this pass, status='degraded'
 *   b) computePreaggReadiness(defaultWorkspace) for the serveability probe
 *   c) If we have parsed sweeps from logs: for each, mergeSweep → upsertSweep
 *      Else (degraded or no sweep start seen): write ONE probe-snapshot sweep so
 *      history still accrues even without log access
 *   d) pruneOlderThan(now - 30 days)
 *
 * The collector never crashes the server — a catch-all wraps each pass and
 * records the error to the collector status getter instead.
 */

import { readWorkerLogsSince, DockerLogError } from './docker-log-reader.js';
import { consumeBuildLogSnapshots } from './preagg-build-log-snapshot-ingest.js';
import { parseWorkerLog } from './preagg-run-parser.js';
import type { ParsedSweep } from '../types/preagg-run.js';
import { mergeSweep } from './preagg-run-merge.js';
import { computePreaggReadiness } from './preagg-readiness.js';
import { maybeTriggerAutoBuild } from './preagg-auto-build.js';
import { getDefaultWorkspace } from './workspaces-config-loader.js';
import { upsertSweep, pruneOlderThan, getLatestSweep } from '../db/preagg-run-store.js';
import { getDb } from '../db/sqlite.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 300_000; // 5 minutes
const RETENTION_DAYS = 30;
const DEFAULT_CONTAINER = 'cube-playground-cube-refresh-worker-dev';

// ---------------------------------------------------------------------------
// Module-level collector state (single instance)
// ---------------------------------------------------------------------------

type CollectorStatus = 'online' | 'degraded' | 'disabled';

let _status: CollectorStatus = 'disabled';
let _lastError: string | null = null;
let _lastPassAt: string | null = null;

export function getCollectorStatus(): { status: CollectorStatus; lastError: string | null; lastPassAt: string | null } {
  return { status: _status, lastError: _lastError, lastPassAt: _lastPassAt };
}

// ---------------------------------------------------------------------------
// Collector pass logic
// ---------------------------------------------------------------------------

/** Cursor: Unix timestamp (seconds) of the last log line we processed. */
let _logCursorUnix = 0;

async function runPass(container: string): Promise<void> {
  const now = new Date();
  const db = getDb();
  const workspace = getDefaultWorkspace();

  // ── Step A: read Docker logs since cursor ──────────────────────────────────
  let parsedSweeps: ParsedSweep[] = [];
  let collectorStatus: CollectorStatus = 'online';
  let dockerLines: string[] = [];

  try {
    dockerLines = await readWorkerLogsSince(container, _logCursorUnix);
    // Advance cursor to now so next pass only fetches the delta.
    // We advance even if no sweeps were found — avoids re-reading old lines.
    _logCursorUnix = Math.floor(now.getTime() / 1000);
  } catch (err) {
    if (err instanceof DockerLogError) {
      collectorStatus = 'degraded';
      _lastError = err.message;
    } else {
      throw err; // unexpected — rethrow so outer catch records it
    }
  }

  // Trigger-script snapshots: logs dumped before a container force-recreate
  // would otherwise be lost forever (the recreate wipes docker log history).
  // They predate the live lines, so prepend; re-parsed windows the collector
  // already recorded live land on the same started_at and upsert idempotently.
  // Consumed even on a degraded docker read — the snapshot files come off the
  // filesystem, not the docker socket, so they're still ingestable.
  const snapshotLines = consumeBuildLogSnapshots();
  parsedSweeps = parseWorkerLog([...snapshotLines, ...dockerLines]);

  // ── Step B: serveability probe ─────────────────────────────────────────────
  const probe = await computePreaggReadiness(workspace);

  // ── Step B2: auto-build newly-discovered unbuilt rollups ───────────────────
  // No-op unless PREAGG_AUTO_BUILD_ENABLED=true. Single-flight + per-game
  // cooldown live inside the helper; never throws.
  maybeTriggerAutoBuild(probe);

  // ── Step C: persist ────────────────────────────────────────────────────────
  if (parsedSweeps.length > 0) {
    // We have actual sweep windows from logs — one row per parsed sweep
    for (const parsedSweep of parsedSweeps) {
      const { sweep, items } = mergeSweep(probe, parsedSweep.failures, {
        source: 'scheduled',
        startedAt: parsedSweep.startedAt,
        endedAt: parsedSweep.endedAt,
        collectorStatus,
      }, parsedSweep.builds);
      upsertSweep(db, sweep, items);
    }
  } else {
    // No new sweep seen (degraded log access OR worker hasn't swept yet) —
    // write a probe-snapshot so the history table still gets populated and
    // the /current endpoint always has fresh serveability data.
    const snapshotTs = now.toISOString();
    const { sweep, items } = mergeSweep(probe, [], {
      source: 'probe-snapshot',
      startedAt: snapshotTs,
      endedAt: snapshotTs,
      collectorStatus,
    });

    // Dedup: while serveability is unchanged, repeated snapshots are noise —
    // every poll would add an identical row. Only record when an outcome count
    // moves from the previous snapshot. (A real worker sweep takes the branch
    // above and always records, even when counts match.)
    const latest = getLatestSweep(db);
    const unchanged =
      latest !== null &&
      latest.source === 'probe-snapshot' &&
      latest.sealedCount === sweep.sealedCount &&
      latest.staleCount === sweep.staleCount &&
      latest.failedCount === sweep.failedCount &&
      latest.unbuiltCount === sweep.unbuiltCount;
    if (!unchanged) {
      upsertSweep(db, sweep, items);
    }
  }

  // ── Step D: prune old records ──────────────────────────────────────────────
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  pruneOlderThan(db, cutoff);

  _status = collectorStatus;
  _lastPassAt = now.toISOString();
  if (collectorStatus === 'online') _lastError = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the collector interval. Call once from index.ts after app.listen.
 *
 * Returns immediately (no-op) when PREAGG_COLLECTOR_ENABLED !== 'true'.
 * The `deps` parameter allows injecting a custom pass function in tests.
 */
export function startPreaggRunCollector(deps?: { pass?: () => Promise<void> }): void {
  if (process.env.PREAGG_COLLECTOR_ENABLED !== 'true') {
    _status = 'disabled';
    return;
  }

  const intervalMs = parseInt(process.env.PREAGG_COLLECTOR_INTERVAL_MS ?? '', 10) || DEFAULT_INTERVAL_MS;
  const container = process.env.PREAGG_WORKER_CONTAINER ?? DEFAULT_CONTAINER;
  const pass = deps?.pass ?? (() => runPass(container));

  // Run one pass immediately so the UI has data right after boot
  pass().catch((err: unknown) => {
    _status = 'degraded';
    _lastError = err instanceof Error ? err.message : String(err);
  });

  setInterval(() => {
    pass().catch((err: unknown) => {
      _status = 'degraded';
      _lastError = err instanceof Error ? err.message : String(err);
    });
  }, intervalMs);
}
