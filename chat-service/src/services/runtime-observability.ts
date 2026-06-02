/**
 * Lightweight runtime observability for the chat-service Fastify app.
 *
 * Twin of server/src/services/runtime-observability.ts — duplicated rather than
 * shared because the two services are separate npm packages with their own
 * tsconfig (`rootDir: src`); a cross-package relative import would scatter the
 * compiled output and break the container COPY layout.
 *
 * Two signals that make "chat feels like it hangs" greppable in logs/dev-all.log:
 *
 *   1. Slow-request log — onResponse warn when a request exceeds SLOW_REQ_MS.
 *      The 504s seen on the trivial GET /notifications poll were the fingerprint
 *      of loop starvation while a chat turn (child Claude CLI) was streaming;
 *      this surfaces them explicitly instead of by grepping `responseTime`.
 *
 *   2. Event-loop lag monitor — perf_hooks.monitorEventLoopDelay. The Claude
 *      Agent SDK spawns a child process and streams for seconds, and
 *      better-sqlite3 reads/sweeps are synchronous; either can block the single
 *      thread so cheap polls queue behind them. Loop lag measures that directly.
 */

import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { FastifyInstance } from 'fastify';

const round = (n: number): number => Math.round(n * 100) / 100;

/** onResponse hook: warn-log any request slower than the threshold. */
export function registerSlowRequestLog(app: FastifyInstance, thresholdMs = num('SLOW_REQ_MS', 1000)): void {
  app.addHook('onResponse', async (req, reply) => {
    const ms = reply.elapsedTime;
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
