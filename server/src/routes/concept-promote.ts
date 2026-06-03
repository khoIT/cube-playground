/**
 * POST /api/concepts/promote
 *
 * Promotes a segment into a draft glossary term and/or a draft metric stub.
 * Auth: requires at least 'editor' role.
 * IDOR guard: source segment must belong to the active workspace (404 on miss).
 *
 * Body:
 *   sourceType   — 'segment' (only supported source for now)
 *   sourceId     — segment id
 *   targetType   — 'term' | 'metric' | 'both'
 *   termId?      — override the derived glossary term id
 *
 * Response 201:
 *   { term?: GlossaryTerm, metric?: BusinessMetric }
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/sqlite.js';
import { requireRole } from '../middleware/require-role.js';
import { buildTermDraftFromSegment } from '../services/promote-to-term.js';
import { scaffoldDraftMetric } from '../services/metric-stub-scaffolder.js';
import { getAll as getAllMetrics, writeMetric } from '../services/business-metrics-loader.js';
import { invalidateReverseIndex } from '../services/concept-reverse-index.js';
import { insertAuditRow } from '../db/business-metric-audit-store.js';
import { DefaultFilterSchema } from './glossary-validators.js';
import {
  rowToTerm,
  termToWriteParams,
  slugify,
  type GlossaryRow,
} from './glossary-row-mapper.js';
import type { PredicateNode } from '../types/predicate-tree.js';

const SELECT_COLS = `id, label, description, primary_catalog_id, secondary_catalog_ids,
  aliases, category, updated_at, label_vi, description_vi, aliases_vi, status, source, editor_name,
  entity_cube, entity_pk, default_measure_ref, default_filter_json, ranking_json, trust_tier`;

const PromoteBodySchema = z.object({
  sourceType: z.literal('segment'),
  sourceId: z.string().min(1),
  targetType: z.enum(['term', 'metric', 'both']),
  /** Override the derived glossary term id. Must be unique. */
  termId: z.string().trim().min(1).max(64).optional(),
}).strict();

interface SegmentRow {
  id: string;
  name: string;
  cube: string | null;
  predicate_tree_json: string | null;
  game_id: string;
  workspace: string;
  cube_query_json: string | null;
}

export default async function conceptPromoteRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/concepts/promote',
    { preHandler: requireRole('editor', 'admin') },
    async (req, reply) => {
      const parsed = PromoteBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'VALIDATION', issues: parsed.error.issues },
        });
      }

      const { sourceId, targetType, termId: termIdOverride } = parsed.data;
      const db = getDb();

      // IDOR guard: fetch segment scoped to the active workspace.
      // A segment in workspace A is invisible to workspace B — treated as 404,
      // not 403, to avoid leaking existence across workspace boundaries.
      const segRow = db
        .prepare('SELECT id, name, cube, predicate_tree_json, game_id, workspace, cube_query_json FROM segments WHERE id = ? AND workspace = ?')
        .get(sourceId, req.workspace.id) as SegmentRow | undefined;

      if (!segRow) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Segment not found in active workspace' },
        });
      }

      let predicateTree: PredicateNode | null = null;
      if (segRow.predicate_tree_json) {
        try {
          predicateTree = JSON.parse(segRow.predicate_tree_json) as PredicateNode;
        } catch {
          // malformed JSON — treat as no predicate
        }
      }

      const segForPromotion = {
        id: segRow.id,
        name: segRow.name,
        cube: segRow.cube,
        predicate_tree: predicateTree,
        game_id: segRow.game_id,
      };

      const result: { term?: unknown; metric?: unknown } = {};

      // ── Promote to glossary term ──────────────────────────────────────────
      if (targetType === 'term' || targetType === 'both') {
        const draft = buildTermDraftFromSegment(segForPromotion);

        // Validate the derived filter through the SAME schema a direct write
        // uses — a promoted draft must clear the same bar as a hand-authored one.
        if (draft.defaultFilter) {
          const ok = DefaultFilterSchema.safeParse(draft.defaultFilter);
          if (!ok.success) {
            return reply.status(400).send({
              error: { code: 'INVALID_FILTER', message: 'segment predicate did not map to a valid term filter' },
            });
          }
        }
        const resolvedId = termIdOverride?.trim() || draft.id || slugify(segRow.name);
        if (!resolvedId) {
          return reply.status(400).send({
            error: { code: 'BAD_REQUEST', message: 'Could not derive a glossary term id' },
          });
        }

        // Conflict check — return 409 rather than silent overwrite.
        const existing = db
          .prepare(`SELECT id FROM glossary_terms WHERE id = ?`)
          .get(resolvedId);
        if (existing) {
          return reply.status(409).send({
            error: {
              code: 'CONFLICT',
              message: `Glossary term "${resolvedId}" already exists`,
            },
          });
        }

        const now = Date.now();
        const jsonOrNull = (v: unknown): string | null =>
          v != null && typeof v === 'object' && Object.keys(v as object).length
            ? JSON.stringify(v)
            : null;

        db.prepare(`
          INSERT INTO glossary_terms
            (${SELECT_COLS})
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(...termToWriteParams({
          id: resolvedId,
          label: draft.label,
          description: draft.description,
          primaryCatalogId: draft.primaryCatalogId ?? null,
          secondaryCatalogIds: draft.secondaryCatalogIds ?? [],
          aliases: [],
          category: null,
          updatedAt: now,
          labelVi: null,
          descriptionVi: null,
          aliasesVi: [],
          editorName: draft.editorName ?? req.owner,
          entityCube: draft.entityCube ?? null,
          entityPk: null,
          defaultMeasureRef: draft.defaultMeasureRef ?? null,
          // Cast GlossaryFilter to the generic Record shape termToWriteParams expects.
          defaultFilter: draft.defaultFilter
            ? (draft.defaultFilter as unknown as Record<string, unknown>)
            : null,
          ranking: null,
          trustTier: null,
          status: 'draft',
          source: 'user',
        }));

        const termRow = db
          .prepare(`SELECT ${SELECT_COLS} FROM glossary_terms WHERE id = ?`)
          .get(resolvedId) as GlossaryRow;
        result.term = rowToTerm(termRow);
        invalidateReverseIndex();
        // Traceability for term promotion. The audit STORE is metric-scoped
        // (business_metric_audit.metric_id NOT NULL), so a structured log is the
        // honest record here; a dedicated glossary audit log is a follow-up.
        app.log.info(
          { termId: resolvedId, sourceSegment: segRow.id, actor: req.owner, requestId: req.id },
          '[concept-promote] segment promoted to draft glossary term',
        );
      }

      // ── Promote to metric stub ────────────────────────────────────────────
      if (targetType === 'metric' || targetType === 'both') {
        // Build a measure ref from the segment's cube — best-effort. If cube is
        // null, we scaffold with a placeholder ref the human can fix.
        const measureRef = segRow.cube
          ? `${segRow.cube}.count`
          : `unknown.${slugify(segRow.name) || 'measure'}`;

        const existing = getAllMetrics();
        const takenIds = new Set(existing.map((m) => m.id));
        let stub;
        try {
          stub = scaffoldDraftMetric(measureRef, takenIds);
        } catch (err) {
          return reply.status(400).send({
            error: {
              code: 'SCAFFOLD_FAILED',
              message: err instanceof Error ? err.message : String(err),
            },
          });
        }

        // Override label with the segment name for better traceability.
        stub.metric = {
          ...stub.metric,
          label: segRow.name,
          description: `Draft metric promoted from segment "${segRow.name}". Review formula ref before certifying.`,
        };

        try {
          await writeMetric(stub.metric);
        } catch (err) {
          return reply.status(500).send({
            error: {
              code: 'WRITE_FAILED',
              message: err instanceof Error ? err.message : String(err),
            },
          });
        }

        // Audit the promotion — best-effort, non-fatal.
        try {
          insertAuditRow(db, {
            metricId: stub.id,
            action: 'create',
            oldValueJson: null,
            newValueJson: JSON.stringify(stub.metric),
            actorKind: 'user',
            actorId: req.owner,
            reason: `promoted from segment ${segRow.id}`,
            requestId: req.id,
          });
        } catch (auditErr) {
          app.log.warn({ err: auditErr }, '[concept-promote] audit insert failed (non-fatal)');
        }

        result.metric = stub.metric;
        invalidateReverseIndex();
      }

      return reply.status(201).send(result);
    },
  );
}
