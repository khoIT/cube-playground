/**
 * Drift Center HTTP surface (extracted from business-metrics.ts to keep that
 * host file readable). Registered alongside it; same `/api/business-metrics`
 * prefix, so the global `enforce-write-roles` preHandler gates the two PATCH
 * mutations (viewer → 403) for free. GET is read-only, no gate.
 *
 *   GET   /api/business-metrics/drift-center?game=  — root-cause-grouped drift
 *                                                     for the ACTIVE game only.
 *   PATCH /api/business-metrics/:id/repoint         — remap a broken ref.
 *   PATCH /api/business-metrics/:id/applicability   — mark a metric N/A per game.
 *
 * Drift is only meaningful on the local `game_id` model (cube names match the
 * registry verbatim). On a `gameModel:'prefix'` workspace (prod) every ref
 * would falsely read `cube-missing` — so we short-circuit with
 * `prefixUnsupported:true` instead of returning a wall of false drift.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  BusinessMetricFormulaSchema,
  type BusinessMetric,
  type BusinessMetricFormula,
  type MetricApplicabilityEntry,
} from '../types/business-metric.js';
import { getAll, getById, writeMetric } from '../services/business-metrics-loader.js';
import { resolveCoverageForGame } from '../services/metric-coverage-resolver.js';
import { groupDriftByRootCause } from '../services/metric-drift-grouping.js';
import { applicableForGame } from '../services/metric-applicability.js';
import { getMetaWithCtx } from '../services/cube-client.js';
import { userCanAccessGame } from '../auth/authz-decisions.js';
import type { FastifyRequest } from 'fastify';
import {
  parseFqn,
  snapshotFromMeta,
  type MetaResponse,
} from '../services/metric-ref-validator.js';
import { getDb } from '../db/sqlite.js';
import {
  upsertDriftRows,
  listDriftRows,
  type DriftRowInput,
} from '../db/metric-drift-snapshot-store.js';
import { listDriftRuns } from '../db/metric-drift-run-store.js';
import { runDriftReconciliation, driftReconcileIntervalMs } from '../jobs/anomaly-detector.js';
import { insertAuditRow } from '../db/business-metric-audit-store.js';

const RepointSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  game: z.string().min(1).optional(),
  actor: z.string().min(1).optional(),
  note: z.string().max(280).optional(),
});

const ApplicabilitySchema = z.object({
  game: z.string().min(1),
  applicable: z.boolean(),
  actor: z.string().min(1).optional(),
  note: z.string().max(280).optional(),
});

/** Rewrite the slot(s) holding `from` to `to`, preserving the formula type. */
function rewriteRef(
  formula: BusinessMetricFormula,
  from: string,
  to: string,
): { formula: BusinessMetricFormula; changed: boolean } {
  if (formula.type === 'measure') {
    if (formula.ref === from) return { formula: { ...formula, ref: to }, changed: true };
    return { formula, changed: false };
  }
  if (formula.type === 'ratio') {
    let changed = false;
    const next = { ...formula };
    if (next.numerator === from) { next.numerator = to; changed = true; }
    if (next.denominator === from) { next.denominator = to; changed = true; }
    return { formula: next, changed };
  }
  // expression: refs live in inputs[]
  const inputs = formula.inputs ?? [];
  let changed = false;
  const nextInputs = inputs.map((i) => (i === from ? ((changed = true), to) : i));
  return { formula: { ...formula, inputs: nextInputs }, changed };
}

/**
 * Game-grant guard. These routes take `game` from the query/body (not the
 * `x-cube-game` header), so the upstream `workspace-header` game check — which
 * keys off the header — never fires here. Re-check the grant: an authenticated
 * user must hold the game before we mint a token / fetch its /meta. Skipped in
 * AUTH_DISABLED dev mode (no `req.user`), matching the upstream pattern.
 */
function gameForbidden(req: FastifyRequest, game: string): boolean {
  // Per-workspace grant: check the game against the workspace this request
  // targets (resolved upstream into req.workspace by the workspace-header hook).
  return !!req.user && !userCanAccessGame(req.user, req.workspace.id, game);
}

/**
 * Schedule + last-N runs for the "Detector runs" tab. next-run is derived from
 * the most recent run's start + the reconcile interval, so the estimate survives
 * a server restart (the job's in-memory lastRunAt does not).
 */
function buildRunsPayload(game: string, limit: number) {
  const runs = listDriftRuns(getDb(), game, limit);
  const intervalMs = driftReconcileIntervalMs();
  const lastRunAt = runs[0]?.startedAt ?? null;
  const nextRunAt = lastRunAt
    ? new Date(new Date(lastRunAt).getTime() + intervalMs).toISOString()
    : null;
  return { game, intervalMs, lastRunAt, nextRunAt, runs };
}

function auditActor(req: { headers: Record<string, unknown> }): {
  kind: 'agent' | 'user';
  id: string | null;
} {
  const kind = req.headers['x-actor-kind'] === 'agent' ? 'agent' : 'user';
  const id = typeof req.headers['x-actor-id'] === 'string' ? req.headers['x-actor-id'] : null;
  return { kind, id };
}

export default async function businessMetricsDriftRoutes(app: FastifyInstance): Promise<void> {
  // ── GET grouped drift for the active game ─────────────────────────────────
  app.get<{ Querystring: { game?: string } }>(
    '/api/business-metrics/drift-center',
    async (req, reply) => {
      const game = req.query.game;
      if (!game) {
        return reply.status(400).send({
          error: { code: 'GAME_REQUIRED', message: '`game` query param is required' },
        });
      }
      if (gameForbidden(req, game)) {
        return reply.status(403).send({
          error: { code: 'GAME_FORBIDDEN', message: `game "${game}" is not granted to this user` },
        });
      }

      // Detector rows are always under ('local', game, 'detector') — they stay
      // distinct from the live groups (no merge). Populated even on prefix.
      const detectorRows = listDriftRows(getDb(), {
        workspaceId: 'local',
        game,
        source: 'detector',
      });
      const detectorPanel = {
        groups: groupDriftByRootCause(
          detectorRows.map((r) => ({ metricId: r.metricId, ref: r.ref, reason: r.reason })),
        ),
        updatedAt: detectorRows[0]?.updatedAt ?? null,
      };

      const generatedAt = new Date().toISOString();

      // prefix workspaces (prod): drift not meaningful without ref translation.
      if (req.workspace.gameModel === 'prefix') {
        return { game, groups: [], detectorPanel, prefixUnsupported: true, generatedAt };
      }

      const metrics = getAll();
      const byId = new Map(metrics.map((m) => [m.id, m]));
      const isApplicable = (id: string): boolean => {
        const m = byId.get(id);
        return m ? applicableForGame(m, game) : true;
      };

      const ctx = req.buildCubeCtxForGame(game);
      const { coverage } = await resolveCoverageForGame(metrics, game, undefined, ctx, isApplicable);
      if (coverage.status === 'error') {
        return reply.status(502).send({
          error: { code: 'META_FETCH_FAILED', message: coverage.error ?? 'meta fetch failed' },
        });
      }

      // Persist live rows (N/A already excluded by coverage's applicability filter).
      const rows: DriftRowInput[] = coverage.brokenRefs.map((u) => ({
        metricId: u.metricId,
        ref: u.ref,
        reason: u.reason,
      }));
      try {
        upsertDriftRows(getDb(), { workspaceId: req.workspace.id, game, source: 'live', rows });
      } catch (err) {
        app.log.warn({ err }, '[drift-center] live snapshot persist failed (non-fatal)');
      }

      return {
        game,
        groups: groupDriftByRootCause(coverage.brokenRefs),
        detectorPanel,
        prefixUnsupported: false,
        generatedAt,
      };
    },
  );

  // ── PATCH repoint a broken ref ────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/api/business-metrics/:id/repoint',
    async (req, reply) => {
      const prev = getById(req.params.id);
      if (!prev) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `metric "${req.params.id}" not found` },
        });
      }
      const parsed = RepointSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'invalid body' },
        });
      }
      const { from, to, actor, note } = parsed.data;

      // Authz first: resolve + grant-check the game before doing any work.
      // (The upstream game gate keys off the x-cube-game header; this route
      // takes `game` from the body, so it must re-check.)
      const gameId = parsed.data.game ?? prev.meta?.game_id ?? null;
      if (!gameId) {
        return reply.status(400).send({
          error: { code: 'GAME_UNKNOWN', message: 'cannot validate target ref without a game — pass `game` or set meta.game_id' },
        });
      }
      if (gameForbidden(req, gameId)) {
        return reply.status(403).send({
          error: { code: 'GAME_FORBIDDEN', message: `game "${gameId}" is not granted to this user` },
        });
      }

      const { formula, changed } = rewriteRef(prev.formula, from, to);
      if (!changed) {
        return reply.status(400).send({
          error: { code: 'FROM_NOT_FOUND', message: `ref "${from}" not present in formula` },
        });
      }

      // Backstop: the FE picker offers only live members, but /meta may shift
      // between fetch and submit — re-validate the target against live /meta.
      const ctx = req.buildCubeCtxForGame(gameId);
      if (req.workspace.authMode !== 'none' && !ctx.token) {
        return reply.status(400).send({
          error: { code: 'GAME_UNKNOWN', message: `no Cube token for game "${gameId}"` },
        });
      }
      let meta: MetaResponse;
      try {
        meta = (await getMetaWithCtx(ctx)) as MetaResponse;
      } catch (err) {
        return reply.status(502).send({
          error: { code: 'META_FETCH_FAILED', message: err instanceof Error ? err.message : String(err) },
        });
      }
      const snapshot = snapshotFromMeta(meta);
      const p = parseFqn(to);
      const resolves = !!p && snapshot.cubes.has(p.cube) && snapshot.members.has(p.fqn);
      if (!resolves) {
        return reply.status(400).send({
          error: {
            code: 'REFS_UNRESOLVED',
            message: `target ref "${to}" does not resolve against /meta for game "${gameId}"`,
            missingRefs: [to],
          },
        });
      }

      const next: BusinessMetric = { ...prev, formula: BusinessMetricFormulaSchema.parse(formula) };
      try {
        await writeMetric(next);
      } catch (err) {
        return reply.status(500).send({
          error: { code: 'WRITE_FAILED', message: err instanceof Error ? err.message : String(err) },
        });
      }
      try {
        const a = auditActor(req);
        insertAuditRow(getDb(), {
          metricId: prev.id,
          action: 'update',
          oldValueJson: JSON.stringify(prev.formula),
          newValueJson: JSON.stringify(next.formula),
          actorKind: actor ? 'user' : a.kind,
          actorId: actor ?? a.id,
          reason: note ?? `repoint ${from} → ${to}`,
          requestId: req.id,
        });
      } catch (auditErr) {
        app.log.warn({ err: auditErr }, '[drift-center] repoint audit insert failed (non-fatal)');
      }
      return reply.status(200).send(next);
    },
  );

  // ── PATCH mark a metric N/A (or applicable) per game ──────────────────────
  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/api/business-metrics/:id/applicability',
    async (req, reply) => {
      const prev = getById(req.params.id);
      if (!prev) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `metric "${req.params.id}" not found` },
        });
      }
      const parsed = ApplicabilitySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'invalid body' },
        });
      }
      const { game, applicable, actor, note } = parsed.data;
      if (gameForbidden(req, game)) {
        return reply.status(403).send({
          error: { code: 'GAME_FORBIDDEN', message: `game "${game}" is not granted to this user` },
        });
      }

      const entry: MetricApplicabilityEntry = {
        game,
        applicable,
        at: new Date().toISOString(),
        ...(actor ? { actor } : {}),
        ...(note ? { note } : {}),
      };
      const next: BusinessMetric = {
        ...prev,
        meta: {
          ...(prev.meta ?? {}),
          applicability: [...(prev.meta?.applicability ?? []), entry],
        },
      };
      try {
        await writeMetric(next);
      } catch (err) {
        return reply.status(500).send({
          error: { code: 'WRITE_FAILED', message: err instanceof Error ? err.message : String(err) },
        });
      }
      try {
        const a = auditActor(req);
        insertAuditRow(getDb(), {
          metricId: prev.id,
          action: 'update',
          oldValueJson: JSON.stringify({ applicability: prev.meta?.applicability ?? [] }),
          newValueJson: JSON.stringify({ applicability: next.meta?.applicability ?? [] }),
          actorKind: actor ? 'user' : a.kind,
          actorId: actor ?? a.id,
          reason: note ?? `mark ${game} ${applicable ? 'applicable' : 'n/a'}`,
          requestId: req.id,
        });
      } catch (auditErr) {
        app.log.warn({ err: auditErr }, '[drift-center] applicability audit insert failed (non-fatal)');
      }
      return reply.status(200).send(next);
    },
  );

  // ── GET detector run history + schedule for a game ────────────────────────
  app.get<{ Querystring: { game?: string; limit?: string } }>(
    '/api/business-metrics/drift-runs',
    async (req, reply) => {
      const game = req.query.game;
      if (!game) {
        return reply.status(400).send({
          error: { code: 'GAME_REQUIRED', message: 'pass ?game=' },
        });
      }
      if (gameForbidden(req, game)) {
        return reply.status(403).send({
          error: { code: 'GAME_FORBIDDEN', message: `game "${game}" is not granted to this user` },
        });
      }
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '10', 10) || 10, 1), 50);
      return buildRunsPayload(game, limit);
    },
  );

  // ── POST trigger a reconciliation now (gated by enforce-write-roles) ──────
  app.post<{ Body: { game?: string } }>(
    '/api/business-metrics/drift-runs/run',
    async (req, reply) => {
      const game = req.body?.game;
      if (!game) {
        return reply.status(400).send({
          error: { code: 'GAME_REQUIRED', message: 'pass { game } in body' },
        });
      }
      if (gameForbidden(req, game)) {
        return reply.status(403).send({
          error: { code: 'GAME_FORBIDDEN', message: `game "${game}" is not granted to this user` },
        });
      }
      try {
        await runDriftReconciliation(game, 'manual', (m) => app.log.warn(m));
      } catch (err) {
        return reply.status(502).send({
          error: { code: 'RECONCILE_FAILED', message: err instanceof Error ? err.message : String(err) },
        });
      }
      return buildRunsPayload(game, 10);
    },
  );
}
