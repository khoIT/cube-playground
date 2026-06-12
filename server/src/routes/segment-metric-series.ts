/**
 * Metric-series route — the "metrics movement across time" endpoint.
 *
 *   GET /api/segments/:id/metric-series
 *       ?metric=<key>&lens=current|entry|stayers&anchor=YYYY-MM-DD&days=N
 *
 * Sibling of /trajectory (same guard, same TTL-cache pattern). Registry
 * validates (game, metric) eligibility BEFORE any SQL — only probe-verified
 * (game, mart) pairs are reachable. Also serves the per-segment metric list:
 *
 *   GET /api/segments/:id/eligible-metrics
 */

import type { FastifyInstance } from 'fastify';
import { guardSegment } from './segments.js';
import {
  listEligibleMetrics,
  resolveMetricBinding,
} from '../lakehouse/segment-metric-registry.js';
import {
  readMetricSeries,
  clampMetricDays,
  isValidAnchor,
  type MetricLens,
  type MetricSeriesResult,
} from '../lakehouse/segment-metric-series-reader.js';

const CACHE_TTL_MS = 60 * 60_000; // daily-moving data

interface MetricSeriesPayload extends MetricSeriesResult {
  segmentId: string;
  gameId: string;
  metric: string;
  label: string;
  unit: string;
  lens: MetricLens;
  anchor: string | null;
  days: number;
  /** Hard-labelled for the stayers lens — consumers must show it. */
  survivorBiased: boolean;
}

// Bounded: the key space includes a free-form anchor date, so without a cap an
// authenticated user could grow this map without limit. Insertion-order
// eviction is enough for a 1h-TTL daily-data cache.
const MAX_CACHE_ENTRIES = 500;
const cache = new Map<string, { at: number; payload: MetricSeriesPayload }>();

/** Test hook — clears the route cache. */
export function __clearMetricSeriesCache(): void {
  cache.clear();
}

const LENSES: MetricLens[] = ['current', 'entry', 'stayers'];

export default async function segmentMetricSeriesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/segments/:id/eligible-metrics', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = guardSegment(req, reply, id, 'read');
    if (!row) return reply;
    const gameId = typeof row.game_id === 'string' ? row.game_id : '';
    return {
      metrics: listEligibleMetrics(gameId).map(({ metricKey, label, unit }) => ({ metricKey, label, unit })),
    };
  });

  app.get('/api/segments/:id/metric-series', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = guardSegment(req, reply, id, 'read');
    if (!row) return reply;

    const gameId = typeof row.game_id === 'string' ? row.game_id : null;
    if (row.type !== 'predicate' || !gameId) {
      return reply.status(404).send({
        error: { code: 'NO_METRIC_SERIES', message: 'Metric series exists only for predicate segments with a game' },
      });
    }

    const q = req.query as Record<string, string | undefined>;
    const lens = (q.lens ?? 'current') as MetricLens;
    if (!LENSES.includes(lens)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: `lens must be one of ${LENSES.join('|')}` } });
    }
    const binding = q.metric ? resolveMetricBinding(gameId, q.metric) : null;
    if (!binding) {
      return reply.status(400).send({
        error: { code: 'METRIC_NOT_ELIGIBLE', message: `metric '${q.metric ?? ''}' is not registry-eligible for game ${gameId}` },
      });
    }
    const anchor = q.anchor;
    if (lens !== 'current' && !isValidAnchor(anchor)) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: `lens '${lens}' requires anchor=YYYY-MM-DD` },
      });
    }
    const days = clampMetricDays(q.days);

    const key = [id, binding.metricKey, lens, anchor ?? '', days].join(':');
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload;

    try {
      const result = await readMetricSeries({
        gameId,
        segmentId: id,
        binding,
        lens,
        anchor: lens === 'current' ? undefined : anchor,
        days,
      });
      const payload: MetricSeriesPayload = {
        ...result,
        segmentId: id,
        gameId,
        metric: binding.metricKey,
        label: binding.label,
        unit: binding.unit,
        lens,
        anchor: lens === 'current' ? null : (anchor as string),
        days,
        survivorBiased: lens === 'stayers',
      };
      if (cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, { at: Date.now(), payload });
      return payload;
    } catch (err) {
      return reply.status(502).send({
        error: { code: 'LAKEHOUSE_UNAVAILABLE', message: (err as Error).message },
      });
    }
  });
}
