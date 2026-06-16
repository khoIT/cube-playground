/**
 * Query-performance monitoring API.
 *
 *   GET /api/query-perf/failures?since=&limit=   — non-200 / failed queries, newest first (the actionable list)
 *   GET /api/query-perf/recent?since=&limit=     — 200 queries for the (default-closed) success list
 *   GET /api/query-perf/summary?since=           — KPI rollups (totals, failures, slow, fallthrough, p50/p95)
 *
 * All routes admin-gated: requireRole('admin') + requireFeature('admin') — same
 * guard as preagg-runs. Rows carry the NAMES-only `shape` (no query values).
 * `preaggHit` is NULL until the classifier phase wires read-time enrichment.
 */

import type { FastifyInstance } from 'fastify';
import { requireRole } from '../middleware/require-role.js';
import { requireFeature } from '../middleware/require-feature.js';
import { getDb } from '../db/sqlite.js';
import { queryPerf, summarizeQueryPerf, getQueryPerfById, type QueryPerfRow } from '../services/query-perf-store.js';
import { classifyQueryPerf, buildRegistryView, type RegistryView } from '../services/query-perf-classifier.js';
import { buildSuggestion } from '../services/optimization-playbook-matcher.js';
import type { OptimizationPlaybook } from '../services/optimization-playbooks.js';
import { scaffoldRollupDraft } from '../services/rollup-yaml-scaffolder.js';
import { suggestViaLlm } from '../services/query-perf-llm-suggester.js';

/** Parse a numeric querystring param with a fallback + cap. */
function intParam(raw: string | undefined, fallback: number, cap: number): number {
  const n = parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, cap);
}

/** Optional `since` epoch-ms window param. */
function sinceParam(raw: string | undefined): number | undefined {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Shape a stored row into the API DTO + read-time classifier verdict. The
 * verdict (preagg-hit tri-state + matchability + reason) is computed against the
 * row's game registry view — see query-perf-classifier. Per-game views are
 * memoized within a single request via `viewCache`.
 */
function toDto(r: QueryPerfRow, viewCache: Map<string, RegistryView>) {
  const usedPreaggs = r.usedPreaggs ? safeParseArray(r.usedPreaggs) : [];
  const gameKey = r.game ?? '';
  let view = viewCache.get(gameKey);
  if (!view) {
    view = buildRegistryView(r.game);
    viewCache.set(gameKey, view);
  }
  const verdict = classifyQueryPerf(r.shape, usedPreaggs, r.latencyMs, view);
  return {
    id: r.id,
    ts: r.ts,
    actorEmail: r.actorEmail,
    workspace: r.workspace,
    game: r.game,
    method: r.method,
    status: r.status,
    latencyMs: r.latencyMs,
    usedPreaggs,
    // Stored preagg_hit stays NULL (capture is cheap); the live verdict carries
    // the derived tri-state for the UI.
    preaggHit: verdict.preaggHit,
    matchability: verdict.matchability,
    reason: verdict.reason,
    shape: r.shape,
    errorExcerpt: r.errorExcerpt,
  };
}

function safeParseArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export default async function queryPerfRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireRole('admin'));
  app.addHook('preHandler', requireFeature('admin'));

  // ── GET /api/query-perf/failures ──────────────────────────────────────────
  app.get<{ Querystring: { since?: string; limit?: string } }>(
    '/api/query-perf/failures',
    async (req) => {
      const since = sinceParam(req.query.since);
      const limit = intParam(req.query.limit, 200, 1000);
      const rows = queryPerf(getDb(), { statusClass: 'fail', since, limit });
      const viewCache = new Map<string, RegistryView>();
      return { rows: rows.map((r) => toDto(r, viewCache)) };
    },
  );

  // ── GET /api/query-perf/recent ────────────────────────────────────────────
  // The collapsed success list — fetched lazily by the UI on expand.
  app.get<{ Querystring: { since?: string; limit?: string } }>(
    '/api/query-perf/recent',
    async (req) => {
      const since = sinceParam(req.query.since);
      const limit = intParam(req.query.limit, 200, 1000);
      const rows = queryPerf(getDb(), { statusClass: 'success', since, limit });
      const viewCache = new Map<string, RegistryView>();
      return { rows: rows.map((r) => toDto(r, viewCache)) };
    },
  );

  // ── GET /api/query-perf/summary ───────────────────────────────────────────
  app.get<{ Querystring: { since?: string } }>(
    '/api/query-perf/summary',
    async (req) => {
      const since = sinceParam(req.query.since);
      return summarizeQueryPerf(getDb(), since);
    },
  );

  // ── GET /api/query-perf/:id/suggestion ────────────────────────────────────
  // On-demand (admin clicks "Optimize"): classify the row → match playbooks →
  // return remedies + the best + a needsLlm flag (the P6 LLM hook).
  app.get<{ Params: { id: string } }>(
    '/api/query-perf/:id/suggestion',
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return reply.status(400).send({ error: 'invalid id' });
      const row = getQueryPerfById(getDb(), id);
      if (!row) return reply.status(404).send({ error: 'not found' });

      const usedPreaggs = row.usedPreaggs ? safeParseArray(row.usedPreaggs) : [];
      const view = buildRegistryView(row.game);
      const verdict = classifyQueryPerf(row.shape, usedPreaggs, row.latencyMs, view);
      const s = buildSuggestion(verdict);
      return {
        verdict: s.verdict,
        playbooks: s.playbooks.map(toPlaybookDto),
        best: s.best ? toPlaybookDto(s.best) : null,
        needsLlm: s.needsLlm,
      };
    },
  );

  // ── GET /api/query-perf/:id/scaffold ──────────────────────────────────────
  // On-demand: emit a DRAFT pre_aggregations block for a matchable row. Returns
  // yaml:null + warnings when the shape can't be rolled up (defensive — the UI
  // only offers this for add-rollup matches).
  app.get<{ Params: { id: string } }>(
    '/api/query-perf/:id/scaffold',
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return reply.status(400).send({ error: 'invalid id' });
      const row = getQueryPerfById(getDb(), id);
      if (!row) return reply.status(404).send({ error: 'not found' });
      if (!row.shape) return reply.status(422).send({ error: 'no query shape captured for this row' });

      const usedPreaggs = row.usedPreaggs ? safeParseArray(row.usedPreaggs) : [];
      const view = buildRegistryView(row.game);
      const verdict = classifyQueryPerf(row.shape, usedPreaggs, row.latencyMs, view);
      const draft = scaffoldRollupDraft(row.shape, { matchability: verdict.matchability, registryView: view });
      return { ...draft, verdict };
    },
  );

  // ── POST /api/query-perf/:id/llm-suggest ──────────────────────────────────
  // On-demand LLM remedy — fires ONLY when no playbook fits (needsLlm). Returns
  // 409 when a playbook IS available (LLM reserved for the genuine gap). Errors
  // (timeout / lane exhausted) come back as 200 {error} for a non-blocking UI
  // notice — never a 500.
  app.post<{ Params: { id: string } }>(
    '/api/query-perf/:id/llm-suggest',
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return reply.status(400).send({ error: 'invalid id' });
      const row = getQueryPerfById(getDb(), id);
      if (!row) return reply.status(404).send({ error: 'not found' });
      if (!row.shape) return reply.status(422).send({ error: 'no query shape captured for this row' });

      const usedPreaggs = row.usedPreaggs ? safeParseArray(row.usedPreaggs) : [];
      const view = buildRegistryView(row.game);
      const verdict = classifyQueryPerf(row.shape, usedPreaggs, row.latencyMs, view);
      const s = buildSuggestion(verdict);
      if (!s.needsLlm) {
        return reply.status(409).send({ error: 'playbook available — LLM not needed' });
      }
      const result = await suggestViaLlm(verdict, row.shape, { id, actorSub: req.principal.sub });
      return result;
    },
  );
}

/** Serialize a playbook for the wire — drop the non-serializable predicate. */
function toPlaybookDto(p: OptimizationPlaybook) {
  return { id: p.id, title: p.title, rationale: p.rationale, steps: p.steps, scaffolds: p.scaffolds };
}
