/**
 * Digest runner — scheduled delivery of metric digests to subscribers.
 *
 * Subscriptions live in the digest_subscriptions table (migration 072). Each
 * subscription has a next_run_at (ms epoch) and a last_run_date (YYYY-MM-DD).
 * The runner:
 *   1. Loads subscriptions with next_run_at <= now.
 *   2. For each: checks last_run_date matches today → idempotence guard prevents
 *      double-fire even if the cron ticks twice in one cadence window.
 *   3. Composes a digest payload: open anomaly count + metric list.
 *   4. Fires an in-app notification via notify-client.
 *   5. Advances next_run_at by cadence + sets last_run_date.
 *
 * The Cube query for each metric uses the same pattern as the alert-rule engine.
 * If a metric fails to query, it is included in the digest with value=null rather
 * than aborting the whole digest — never invent a value.
 */

import { load } from '../services/cube-client.js';
import { resolveCubeTokenForGame } from '../services/resolve-cube-token.js';
import { sendNotification } from '../services/notify-client.js';
import { listAnomalies } from '../services/anomaly-state-store.js';
import { getDb } from '../db/sqlite.js';

interface DigestSubscription {
  id: number;
  owner: string;
  game: string;
  metrics_json: string;
  cadence: 'daily' | 'weekly';
  channel: string;
  next_run_at: number | null;
  last_run_date: string | null;
  created_at: number;
}

function loadDueSubscriptions(now: number): DigestSubscription[] {
  try {
    const db = getDb();
    return db
      .prepare(
        `SELECT * FROM digest_subscriptions
          WHERE next_run_at IS NOT NULL AND next_run_at <= ?
          ORDER BY id`,
      )
      .all(now) as DigestSubscription[];
  } catch {
    // Table not migrated yet.
    return [];
  }
}

function advanceNextRunAt(id: number, cadence: 'daily' | 'weekly', lastRunDate: string): void {
  try {
    const db = getDb();
    const ms = cadence === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const nextRunAt = Date.now() + ms;
    db.prepare(
      `UPDATE digest_subscriptions
          SET next_run_at = ?, last_run_date = ?
        WHERE id = ?`,
    ).run(nextRunAt, lastRunDate, id);
  } catch (err) {
    console.warn(`[digest-runner] failed to advance subscription ${id}: ${(err as Error).message}`);
  }
}

function asNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Query the latest value for a single metric from Cube.
 * Returns null when data is unavailable — callers include metric in digest
 * with a null value rather than omitting it.
 */
async function queryMetricLatest(
  game: string,
  metric: string,
): Promise<{ latest: number | null; prev: number | null }> {
  const token = resolveCubeTokenForGame(game);
  if (!token) return { latest: null, prev: null };

  const [cubeName] = metric.split('.');
  const timeDim = `${cubeName}.log_date`;

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 7);

  const query = {
    measures: [metric],
    timeDimensions: [
      {
        dimension: timeDim,
        granularity: 'day',
        dateRange: [startDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10)],
      },
    ],
    order: { [timeDim]: 'desc' },
    limit: 2,
  };

  try {
    const res = (await load(query, token, 15_000)) as { data: Array<Record<string, unknown>> };
    const rows = res.data ?? [];
    const latest = rows.length > 0 ? asNumber(rows[0][metric]) : null;
    const prev = rows.length > 1 ? asNumber(rows[1][metric]) : null;
    return { latest, prev };
  } catch {
    return { latest: null, prev: null };
  }
}

/**
 * Compose a digest payload for a subscription. Queries Cube for each subscribed
 * metric and pulls open anomalies for the game. Includes both even when some
 * metrics fail to query — partial data is surfaced, not hidden.
 */
async function composeDigest(
  sub: DigestSubscription,
  metricIds: string[],
): Promise<object> {
  const metricResults = await Promise.all(
    metricIds.map(async (metric) => {
      const { latest, prev } = await queryMetricLatest(sub.game, metric);
      const deltaPct =
        latest != null && prev != null && prev !== 0
          ? Math.round(((latest - prev) / Math.abs(prev)) * 1000) / 10
          : null;
      return { metric, latest, prev, deltaPct };
    }),
  );

  // Open anomalies for the game — gives the recipient a snapshot of current alerts.
  let openAnomalies: Array<{ metric: string; severity: string; ts: string }> = [];
  try {
    openAnomalies = listAnomalies(sub.game, 'open').map((a) => ({
      metric: a.metric,
      severity: a.severity,
      ts: a.ts,
    }));
  } catch {
    // anomalies table may not exist yet — degrade gracefully.
  }

  return {
    game: sub.game,
    cadence: sub.cadence,
    metrics: metricResults,
    openAnomalies,
    generatedAt: new Date().toISOString(),
  };
}

/** Running flag: prevent a second concurrent digest run within one tick. */
let running = false;

/**
 * Entry point called from the cron tick every 60s. Self-gates on next_run_at
 * per subscription; the last_run_date guard prevents double-fire within the
 * same cadence window even when the server ticks twice.
 */
export async function maybeRunDigests(
  now: number = Date.now(),
  warn: (msg: string) => void = (m) => console.warn(m),
): Promise<{ processed: number; delivered: number }> {
  if (running) return { processed: 0, delivered: 0 };
  running = true;

  let processed = 0;
  let delivered = 0;

  try {
    const due = loadDueSubscriptions(now);
    const todayDate = new Date().toISOString().slice(0, 10);

    for (const sub of due) {
      // Idempotence guard: if last_run_date is already today for this cadence,
      // the cron double-ticked within the same window — skip delivery.
      if (sub.last_run_date === todayDate) {
        // Still advance next_run_at so we don't keep scanning this row every tick.
        advanceNextRunAt(sub.id, sub.cadence, todayDate);
        continue;
      }

      processed++;

      let metricIds: string[] = [];
      try {
        metricIds = JSON.parse(sub.metrics_json) as string[];
      } catch {
        warn(`[digest-runner] invalid metrics_json for subscription ${sub.id}`);
        advanceNextRunAt(sub.id, sub.cadence, todayDate);
        continue;
      }

      if (metricIds.length === 0) {
        advanceNextRunAt(sub.id, sub.cadence, todayDate);
        continue;
      }

      try {
        const payload = await composeDigest(sub, metricIds);
        const ok = await sendNotification({
          ownerId: sub.owner,
          kind: 'digest',
          payload,
        });

        if (ok) {
          delivered++;
        } else {
          warn(`[digest-runner] notification delivery failed for subscription ${sub.id}`);
        }
      } catch (err) {
        warn(`[digest-runner] compose failed for subscription ${sub.id}: ${(err as Error).message}`);
      }

      // Always advance — even on compose/delivery failure — so we don't hammer
      // a broken subscription every minute.
      advanceNextRunAt(sub.id, sub.cadence, todayDate);
    }
  } finally {
    running = false;
  }

  return { processed, delivered };
}
