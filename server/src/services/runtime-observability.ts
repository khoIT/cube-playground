/**
 * Lightweight runtime observability for the Fastify server.
 *
 * Two cheap signals that turn "the app feels sluggish" into greppable evidence
 * in logs/dev-all.log — without any external APM:
 *
 *   1. Slow-request log — an onResponse hook that emits a `warn` whenever a
 *      request's wall time exceeds SLOW_REQ_MS. Fastify already logs every
 *      response with `responseTime`, but at `info`; a slow request is buried
 *      among thousands of fast ones. The explicit warn lets you
 *      `grep '\[slow-request\]' logs/dev-all.log` and see only the stalls.
 *
 *   2. Event-loop lag monitor — `perf_hooks.monitorEventLoopDelay` samples how
 *      long the single thread was blocked between ticks. better-sqlite3 is
 *      SYNCHRONOUS, so a heavy query / bulk write / cron refresh blocks ALL
 *      concurrent request handling; the symptom is a trivial endpoint suddenly
 *      taking seconds. Loop lag is the direct measure of that starvation, which
 *      per-request timing can only hint at. Emits a `warn` when lag over the
 *      sample window crosses EVENT_LOOP_LAG_MS.
 *
 * Both are read-only and allocation-light; safe to leave on in dev and prod.
 */

import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';

const round = (n: number): number => Math.round(n * 100) / 100;

/** onResponse hook: warn-log any request slower than the threshold. */
export function registerSlowRequestLog(app: FastifyInstance, thresholdMs = num('SLOW_REQ_MS', 1000)): void {
  app.addHook('onResponse', async (req, reply) => {
    const ms = reply.elapsedTime; // wall time from request received to response sent
    if (ms >= thresholdMs) {
      app.log.warn(
        { method: req.method, url: req.url, statusCode: reply.statusCode, ms: round(ms) },
        '[slow-request]',
      );
    }
  });
}

/**
 * Start sampling event-loop delay. Returns a stop() to clear the timer.
 * The interval is unref'd so it never keeps the process alive on its own.
 */
export function startEventLoopMonitor(
  log: FastifyInstance['log'],
  lagThresholdMs = num('EVENT_LOOP_LAG_MS', 100),
  sampleMs = num('EVENT_LOOP_SAMPLE_MS', 5000),
): () => void {
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  const timer = setInterval(() => {
    const maxMs = h.max / 1e6;
    if (maxMs >= lagThresholdMs) {
      log.warn(
        { maxMs: round(maxMs), meanMs: round(h.mean / 1e6), p99Ms: round(h.percentile(99) / 1e6), windowMs: sampleMs },
        '[event-loop] blocked over threshold — synchronous work is starving the loop',
      );
    }
    h.reset();
  }, sampleMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    h.disable();
  };
}

function num(key: string, fallback: number): number {
  const v = parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
