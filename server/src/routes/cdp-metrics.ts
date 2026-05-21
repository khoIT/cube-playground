/**
 * MM-01 CDP-metrics proxy.
 *
 * Frontend calls `POST /api/cdp/v1/metrics` via `cdpMetricsClient.createMetric`
 * when `VITE_CDP_ACTIVATION_ENABLED=true`. This module owns the upstream call to
 * MM-01:
 *
 *   1. Read the configured upstream URL + bearer from env. Both required —
 *      missing/empty config returns 503 so the FE can show a clear error rather
 *      than spinning in the proxy.
 *   2. Forward the validated payload with Bearer auth.
 *   3. Surface 4xx/5xx as the same status to the FE, with a sanitized body so
 *      we don't leak upstream internals.
 *
 * Env:
 *   CDP_MM01_URL     full upstream endpoint, e.g. `https://mm-01.internal/v1/metrics`
 *   CDP_MM01_BEARER  bearer token for Authorization header
 *   CDP_MM01_TIMEOUT_MS optional fetch timeout, default 10_000
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const VALID_ENVS = new Set(['dev', 'stag', 'prod']);
const METRIC_NAME_RE = /^[a-z0-9_]{1,64}$/;

const createMetricSchema = z.object({
  metric_name: z.string().regex(METRIC_NAME_RE),
  expression: z.string().min(1),
  filter: z.string(),
  source: z.string().min(1),
  dimensions: z.array(z.string()),
  env: z.string().refine((v) => VALID_ENVS.has(v)),
  game_id: z.string().min(1).max(64),
  materialize: z
    .object({ cron: z.string().min(1) })
    .optional(),
});

interface UpstreamSuccess {
  metric_id: string;
  status: 'active' | 'pending' | 'failed';
  message?: string;
}

function readConfig(): { url: string; bearer: string; timeoutMs: number } | null {
  const url = process.env.CDP_MM01_URL?.trim();
  const bearer = process.env.CDP_MM01_BEARER?.trim();
  if (!url || !bearer) return null;
  const timeoutMs = Number(process.env.CDP_MM01_TIMEOUT_MS) || 10_000;
  return { url, bearer, timeoutMs };
}

export default async function cdpMetricsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/cdp/v1/metrics', async (req, reply) => {
    const parsed = createMetricSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'invalid body' },
      });
    }

    const config = readConfig();
    if (!config) {
      return reply.status(503).send({
        error: {
          code: 'NOT_CONFIGURED',
          message: 'CDP MM-01 upstream not configured (CDP_MM01_URL / CDP_MM01_BEARER missing).',
        },
      });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.timeoutMs);

    try {
      const upstream = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.bearer}`,
        },
        body: JSON.stringify(parsed.data),
        signal: ctrl.signal,
      });

      const text = await upstream.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // upstream returned non-JSON; pass body through as plain text
      }

      if (!upstream.ok) {
        return reply.status(upstream.status).send({
          error: {
            code: 'UPSTREAM',
            message: `MM-01 responded ${upstream.status}`,
            detail: typeof body === 'object' ? body : { raw: body },
          },
        });
      }

      // Trust upstream shape but guard the minimum.
      const ok = body as Partial<UpstreamSuccess>;
      if (!ok || typeof ok.metric_id !== 'string') {
        return reply.status(502).send({
          error: { code: 'UPSTREAM_BAD_SHAPE', message: 'MM-01 returned an unexpected payload.' },
        });
      }
      return reply.send(ok);
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        return reply.status(504).send({
          error: { code: 'UPSTREAM_TIMEOUT', message: 'MM-01 timed out.' },
        });
      }
      const message = err instanceof Error ? err.message : 'unknown upstream error';
      return reply.status(502).send({ error: { code: 'UPSTREAM_FAIL', message } });
    } finally {
      clearTimeout(timer);
    }
  });
}
