/**
 * Business-metrics registry HTTP surface.
 *
 *   GET   /api/business-metrics            — full registry (sorted by id).
 *   GET   /api/business-metrics/:id        — one metric or 404.
 *   POST  /api/business-metrics            — Zod-validate body, atomic write,
 *                                            refresh cache, return 201 + canonicalised body.
 *   PATCH /api/business-metrics/:id/trust  — flip trust + append to trust_history.
 *                                            Promoting to `certified` requires every
 *                                            formula ref to resolve against the metric's
 *                                            primary game `/meta`.
 *
 * Loader cache must already be hydrated (see `loadAll` call in `index.ts`).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  BusinessMetricSchema,
  TRUST_TIERS,
  type BusinessMetric,
  type TrustHistoryEntry,
} from '../types/business-metric.js';
import {
  getAll,
  getById,
  writeMetric,
} from '../services/business-metrics-loader.js';
import { getDrift, resolveTrustForGame } from '../services/metric-trust-resolver.js';
import {
  resolveCoverageAllGames,
  resolveCoverageForGame,
} from '../services/metric-coverage-resolver.js';
import { scaffoldDraftMetric } from '../services/metric-stub-scaffolder.js';
import { getMetaWithCtx } from '../services/cube-client.js';
import {
  snapshotFromMeta,
  validateRefs,
  type MetaResponse,
} from '../services/metric-ref-validator.js';
import { getDb } from '../db/sqlite.js';
import { insertAuditRow, listAudit } from '../db/business-metric-audit-store.js';
import { requireRole } from '../middleware/require-role.js';
import { glossaryTermsReferencingArtifact } from '../services/concept-ref-integrity.js';
import { invalidateReverseIndex } from '../services/concept-reverse-index.js';

const TrustPatchSchema = z.object({
  trust: z.enum(TRUST_TIERS),
  actor: z.string().min(1).optional(),
  note: z.string().max(280).optional(),
});

export default async function businessMetricsRoutes(
  app: FastifyInstance,
): Promise<void> {
  // Optional `?game=<id>` query param: when present, trust is downgraded to
  // `draft` for any metric whose formula refs don't resolve against the
  // game's /meta. Omit the param to get the registry with declared trust
  // (kept for backwards-compat with callers that don't have a game context).
  app.get<{ Querystring: { game?: string } }>(
    '/api/business-metrics',
    async (req) => {
      const metrics = getAll();
      const adjusted = await resolveTrustForGame(metrics, req.query.game ?? null);
      return { metrics: adjusted };
    },
  );

  app.get<{ Querystring: { game?: string } }>(
    '/api/business-metrics/drift',
    async (req, reply) => {
      const gameId = req.query.game;
      if (!gameId) {
        return reply.status(400).send({
          error: { code: 'GAME_REQUIRED', message: '`game` query param is required' },
        });
      }
      try {
        const drift = await getDrift(getAll(), gameId);
        return drift;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(502).send({
          error: { code: 'DRIFT_FAILED', message },
        });
      }
    },
  );

  // Coverage monitor: reconcile the registry against every game's /meta.
  // Optional `?game=` narrows to one game. Fail-open — a game whose token or
  // /meta fetch fails is reported with status:'error', the call still 200s.
  app.get<{ Querystring: { game?: string } }>(
    '/api/business-metrics/coverage',
    async (req, reply) => {
      try {
        if (req.query.game) {
          const ctx = req.buildCubeCtxForGame(req.query.game);
          const { coverage, matrix } = await resolveCoverageForGame(
            getAll(),
            req.query.game,
            undefined,
            ctx,
          );
          return { games: [coverage], matrix, generatedAt: new Date().toISOString() };
        }
        // Workspace-level call (e.g. prod open /meta): pass the game-less ctx so
        // every per-game coverage hit talks to the same workspace URL/auth.
        return await resolveCoverageAllGames(getAll(), req.cubeCtx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(502).send({ error: { code: 'COVERAGE_FAILED', message } });
      }
    },
  );

  // Scaffold draft metric stubs for uncovered cube measures. Idempotent:
  // a ref already covered by some metric (or an id clash) is skipped, not
  // overwritten. Writes go through the same atomic writer as POST.
  app.post<{ Body: { measures?: Array<{ ref?: string }> } }>(
    '/api/business-metrics/scaffold',
    async (req, reply) => {
      const measures = req.body?.measures;
      if (!Array.isArray(measures) || measures.length === 0) {
        return reply.status(400).send({
          error: { code: 'MEASURES_REQUIRED', message: '`measures` must be a non-empty array' },
        });
      }

      const existing = getAll();
      const takenIds = new Set(existing.map((m) => m.id));
      const refsInUse = new Set(
        existing.flatMap((m) =>
          m.formula.type === 'measure'
            ? [m.formula.ref]
            : m.formula.type === 'ratio'
              ? [m.formula.numerator, m.formula.denominator]
              : [],
        ),
      );

      const created: string[] = [];
      const skipped: Array<{ ref: string; reason: string }> = [];

      for (const entry of measures) {
        const ref = entry?.ref;
        if (!ref || typeof ref !== 'string') {
          skipped.push({ ref: String(ref), reason: 'missing or invalid ref' });
          continue;
        }
        if (refsInUse.has(ref)) {
          skipped.push({ ref, reason: 'already referenced by an existing metric' });
          continue;
        }
        let stub;
        try {
          stub = scaffoldDraftMetric(ref, takenIds);
        } catch (err) {
          skipped.push({ ref, reason: err instanceof Error ? err.message : String(err) });
          continue;
        }
        try {
          await writeMetric(stub.metric);
        } catch (err) {
          skipped.push({ ref, reason: `write failed: ${err instanceof Error ? err.message : String(err)}` });
          continue;
        }
        // Reserve id + ref so a second measure in the same batch can't collide.
        takenIds.add(stub.id);
        refsInUse.add(ref);
        created.push(stub.id);

        try {
          insertAuditRow(getDb(), {
            metricId: stub.id,
            action: 'create',
            oldValueJson: null,
            newValueJson: JSON.stringify(stub.metric),
            actorKind: req.headers['x-actor-kind'] === 'agent' ? 'agent' : 'user',
            actorId: typeof req.headers['x-actor-id'] === 'string' ? req.headers['x-actor-id'] : null,
            reason: `scaffolded draft from ${ref}`,
            requestId: req.id,
          });
        } catch (auditErr) {
          app.log.warn({ err: auditErr }, '[business-metrics] scaffold audit insert failed (non-fatal)');
        }
      }

      return reply.status(201).send({ created, skipped });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { game?: string } }>(
    '/api/business-metrics/:id',
    async (req, reply) => {
      const metric = getById(req.params.id);
      if (!metric) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `metric "${req.params.id}" not found` },
        });
      }
      const [adjusted] = await resolveTrustForGame(
        [metric],
        req.query.game ?? null,
      );
      return adjusted ?? metric;
    },
  );

  app.post('/api/business-metrics', async (req, reply) => {
    const parsed = BusinessMetricSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION',
          message: parsed.error.issues[0]?.message ?? 'invalid body',
          issues: parsed.error.issues,
        },
      });
    }

    // Capture the prior value (if any) BEFORE the write so the audit row
    // diff is meaningful for updates (action='update'). New rows record
    // action='create' with `old_value_json=NULL`.
    const prevForAudit = getById(parsed.data.id);

    try {
      await writeMetric(parsed.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({
        error: { code: 'WRITE_FAILED', message },
      });
    }

    // Phase 08 — audit. Best-effort; YAML is the source of truth and is
    // already written by this point. Log + swallow on failure so a SQLite
    // issue can't roll back a successful YAML write.
    try {
      const actorKind = req.headers['x-actor-kind'];
      insertAuditRow(getDb(), {
        metricId: parsed.data.id,
        action: prevForAudit ? 'update' : 'create',
        oldValueJson: prevForAudit ? JSON.stringify(prevForAudit) : null,
        newValueJson: JSON.stringify(parsed.data),
        actorKind: actorKind === 'agent' ? 'agent' : 'user',
        actorId: typeof req.headers['x-actor-id'] === 'string' ? req.headers['x-actor-id'] : null,
        reason: typeof req.headers['x-actor-reason'] === 'string' ? req.headers['x-actor-reason'] : null,
        requestId: req.id,
      });
    } catch (auditErr) {
      app.log.warn({ err: auditErr }, '[business-metrics] audit insert failed (non-fatal)');
    }

    return reply.status(201).send(parsed.data);
  });

  app.patch<{
    Params: { id: string };
    Querystring: { game?: string };
    Body: unknown;
  }>('/api/business-metrics/:id/trust', async (req, reply) => {
    const prev = getById(req.params.id);
    if (!prev) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: `metric "${req.params.id}" not found` },
      });
    }

    const parsed = TrustPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION',
          message: parsed.error.issues[0]?.message ?? 'invalid body',
          issues: parsed.error.issues,
        },
      });
    }
    const { trust: target, actor, note } = parsed.data;

    // Certifying a metric is an admin-only action — it makes the metric a
    // durable source of truth for downstream consumers. Editors may create
    // and update drafts but cannot certify them without admin sign-off.
    // Skip this check when AUTH_DISABLED (dev mode) — the synthesized dev user
    // is always admin, but the mini test-app harnesses skip authenticate entirely.
    const authActive = !['1', 'true', 'yes'].includes(
      (process.env.AUTH_DISABLED ?? '').toLowerCase(),
    );
    if (authActive && target === 'certified' && req.user?.role !== 'admin') {
      return reply.status(403).send({
        error: {
          code: 'INSUFFICIENT_ROLE',
          message: 'certifying a metric requires admin role',
        },
      });
    }

    // Promotion to `certified` requires every formula ref to resolve against
    // the metric's primary game /meta. `draft` and `deprecated` are unconditional.
    if (target === 'certified') {
      const gameId = prev.meta?.game_id ?? req.query.game ?? null;
      if (!gameId) {
        return reply.status(400).send({
          error: {
            code: 'GAME_UNKNOWN',
            message:
              'cannot validate refs without a game — set meta.game_id on the metric or pass ?game=',
          },
        });
      }
      const ctx = req.buildCubeCtxForGame(gameId);
      // 'none' authMode (open prod) is valid — only block when minted/env-token resolved nothing.
      if (req.workspace.authMode !== 'none' && !ctx.token) {
        return reply.status(400).send({
          error: { code: 'GAME_UNKNOWN', message: `no Cube token for game "${gameId}"` },
        });
      }
      let meta: MetaResponse;
      try {
        meta = (await getMetaWithCtx(ctx)) as MetaResponse;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(502).send({
          error: { code: 'META_FETCH_FAILED', message },
        });
      }
      const unresolved = validateRefs([prev], snapshotFromMeta(meta));
      if (unresolved.length > 0) {
        return reply.status(400).send({
          error: {
            code: 'REFS_UNRESOLVED',
            message: `metric "${prev.id}" has unresolved refs against /meta for game "${gameId}"`,
            missingRefs: unresolved.map((u) => u.ref),
          },
        });
      }
    }

    const entry: TrustHistoryEntry = {
      trust: target,
      at: new Date().toISOString(),
      ...(actor ? { actor } : {}),
      ...(note ? { note } : {}),
    };

    const next: BusinessMetric = {
      ...prev,
      trust: target,
      meta: {
        ...(prev.meta ?? {}),
        trust_history: [...(prev.meta?.trust_history ?? []), entry],
      },
    };

    try {
      await writeMetric(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({
        error: { code: 'WRITE_FAILED', message },
      });
    }

    // Phase 08 — record the trust-tier flip. We capture the old and new
    // trust values (not the whole metric) so the history view stays
    // compact + readable.
    try {
      insertAuditRow(getDb(), {
        metricId: prev.id,
        action: 'trust_change',
        oldValueJson: JSON.stringify({ trust: prev.trust }),
        newValueJson: JSON.stringify({ trust: target }),
        actorKind: actor === 'chat' ? 'agent' : (actor ? 'user' : 'system'),
        actorId: actor ?? null,
        reason: note ?? null,
        requestId: req.id,
      });
    } catch (auditErr) {
      app.log.warn({ err: auditErr }, '[business-metrics] trust audit insert failed (non-fatal)');
    }

    return reply.status(200).send(next);
  });

  // Phase 08 — read-only history endpoint. Returns audit rows newest-first
  // with default limit 50. Used by the FE History tab and by the chat-
  // service `get_business_metric_history` tool.
  app.get<{ Params: { id: string }; Querystring: { limit?: string; since?: string } }>(
    '/api/business-metrics/:id/history',
    async (req, reply) => {
      const metric = getById(req.params.id);
      if (!metric) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `metric "${req.params.id}" not found` },
        });
      }
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
      const since = req.query.since ? parseInt(req.query.since, 10) : undefined;
      const rows = listAudit(getDb(), req.params.id, {
        limit: Number.isFinite(limit) ? limit : undefined,
        since: Number.isFinite(since) ? since : undefined,
      });
      return { entries: rows };
    },
  );

  // DELETE /api/business-metrics/:id — remove a metric from the YAML registry.
  // Blocked when a glossary term's secondary_catalog_ids references this metric,
  // because deleting it would leave a dangling ref in the concept graph.
  app.delete<{ Params: { id: string } }>(
    '/api/business-metrics/:id',
    { preHandler: requireRole('admin') },
    async (req, reply) => {
      const metric = getById(req.params.id);
      if (!metric) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `metric "${req.params.id}" not found` },
        });
      }

      // Referential integrity: block delete when a glossary term points at this metric.
      const metricRef = `business_metrics/${req.params.id}`;
      const blocking = glossaryTermsReferencingArtifact(metricRef);
      if (blocking.length > 0) {
        return reply.status(409).send({
          error: {
            code: 'REF_INTEGRITY',
            message: `Cannot delete: glossary term(s) reference this metric`,
            referencedBy: blocking,
          },
        });
      }

      try {
        await writeMetric({ ...metric, trust: 'deprecated' });
        // Audit the delete-via-deprecation as a trust change.
        insertAuditRow(getDb(), {
          metricId: metric.id,
          action: 'delete',
          oldValueJson: JSON.stringify(metric),
          newValueJson: null,
          actorKind: 'user',
          actorId: req.owner,
          reason: 'deleted via API',
          requestId: req.id,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: { code: 'WRITE_FAILED', message } });
      }

      invalidateReverseIndex();
      return reply.status(204).send();
    },
  );
}
