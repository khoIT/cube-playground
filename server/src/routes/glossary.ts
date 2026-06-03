/**
 * Glossary endpoints.
 *   GET    /api/glossary              — list (optional ?status=draft|official)
 *   GET    /api/glossary/:id          — single term lookup
 *   POST   /api/glossary              — create user draft
 *   PUT    /api/glossary/:id          — full replace of editable fields
 *   PATCH  /api/glossary/:id/status   — promote/demote draft<->official
 *   DELETE /api/glossary/:id          — only allowed for source='user' rows
 *
 * List response carries a weak ETag built from MAX(updated_at) so the chat
 * agent's synonym resolver can cheaply revalidate without re-downloading.
 */

import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/sqlite.js';
import {
  rowToTerm,
  termToWriteParams,
  slugify,
  type GlossaryRow,
  type GlossaryTerm,
} from './glossary-row-mapper.js';
import { deriveMeasureRef } from './glossary-measure-ref-resolver.js';
import { getById as getMetricById } from '../services/business-metrics-loader.js';
import { parseRef } from '../services/trust-mapping.js';
import { invalidateReverseIndex } from '../services/concept-reverse-index.js';
import { requireRole } from '../middleware/require-role.js';
import {
  CreateTermSchema,
  UpdateTermSchema,
  StatusPatchSchema,
  ListQuerySchema,
} from './glossary-validators.js';

const SELECT_COLS = `id, label, description, primary_catalog_id, secondary_catalog_ids,
  aliases, category, updated_at, label_vi, description_vi, aliases_vi, status, source, editor_name,
  entity_cube, entity_pk, default_measure_ref, default_filter_json, ranking_json, trust_tier`;

function listEtag(): string {
  const row = getDb()
    .prepare(`SELECT COALESCE(MAX(updated_at), 0) AS m FROM glossary_terms`)
    .get() as { m: number };
  return `W/"${row.m}"`;
}

function getRowById(id: string): GlossaryRow | undefined {
  return getDb()
    .prepare(`SELECT ${SELECT_COLS} FROM glossary_terms WHERE id = ?`)
    .get(id) as GlossaryRow | undefined;
}

/**
 * Resolve the term's catalog path → its cube member(s) so the chat agent's
 * /meta validator sees a real member, not a catalog path. Loader cache is
 * populated at boot; a cold cache degrades to refKind:'unknown' (never throws).
 */
function enrichTerm(term: GlossaryTerm): GlossaryTerm {
  const derived = deriveMeasureRef(term.primaryCatalogId, term.defaultMeasureRef, getMetricById);
  return {
    ...term,
    measureRef: derived.measureRef,
    ratioRef: derived.ratioRef,
    refKind: derived.refKind,
  };
}

/**
 * Returns the subset of typed refs that point at a non-existent target.
 * business_metrics → metric registry; segments → segments table. data_model
 * refs are grammar-only here (live /meta membership is covered by the scheduled
 * metric-coverage check, not on every glossary write).
 */
function danglingRefs(refs: string[] | undefined): string[] {
  if (!refs?.length) return [];
  const bad: string[] = [];
  for (const ref of refs) {
    const parsed = parseRef(ref);
    if (!parsed) { bad.push(ref); continue; }
    if (parsed.namespace === 'business_metrics') {
      if (!getMetricById(parsed.id)) bad.push(ref);
    } else if (parsed.namespace === 'segments') {
      const row = getDb().prepare('SELECT 1 FROM segments WHERE id = ?').get(parsed.id);
      if (!row) bad.push(ref);
    }
  }
  return bad;
}

export default async function glossaryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/glossary', async (req, reply) => {
    const parsed = ListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return reply.status(400).send({ code: 'bad_request', issues: parsed.error.issues });

    // `status` wins; otherwise map the unified `trust` alias onto a status filter.
    const statusFilter =
      parsed.data.status ??
      (parsed.data.trust ? (parsed.data.trust === 'certified' ? 'official' : 'draft') : undefined);
    const sql = statusFilter
      ? `SELECT ${SELECT_COLS} FROM glossary_terms WHERE status = ? ORDER BY label COLLATE NOCASE ASC`
      : `SELECT ${SELECT_COLS} FROM glossary_terms ORDER BY label COLLATE NOCASE ASC`;
    const stmt = getDb().prepare(sql);
    const rows = (statusFilter ? stmt.all(statusFilter) : stmt.all()) as GlossaryRow[];

    const etag = listEtag();
    if (req.headers['if-none-match'] === etag) {
      return reply.status(304).header('etag', etag).send();
    }
    return reply.header('etag', etag).send({ terms: rows.map(rowToTerm).map(enrichTerm) });
  });

  app.get<{ Params: { id: string } }>('/api/glossary/:id', async (req, reply) => {
    const row = getRowById(req.params.id);
    if (!row) return reply.status(404).send({ code: 'not_found' });
    return enrichTerm(rowToTerm(row));
  });

  app.post('/api/glossary', async (req, reply) => {
    const parsed = CreateTermSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ code: 'bad_request', issues: parsed.error.issues });

    const input = parsed.data;
    const id = input.id?.trim() || slugify(input.label);
    if (!id) return reply.status(400).send({ code: 'bad_request', issues: [{ message: 'unable to derive id' }] });

    if (getRowById(id)) return reply.status(409).send({ code: 'conflict', message: 'id exists' });

    const dangling = danglingRefs(input.secondaryCatalogIds);
    if (dangling.length) {
      return reply.status(400).send({ code: 'dangling_ref', message: 'unknown ref target(s)', refs: dangling });
    }

    const now = Date.now();
    getDb().prepare(`
      INSERT INTO glossary_terms
        (${SELECT_COLS})
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(...termToWriteParams({ ...input, id, status: 'draft', source: 'user', updatedAt: now }));

    invalidateReverseIndex();
    return reply.status(201).send(rowToTerm(getRowById(id) as GlossaryRow));
  });

  app.put<{ Params: { id: string } }>('/api/glossary/:id', async (req, reply) => {
    const existing = getRowById(req.params.id);
    if (!existing) return reply.status(404).send({ code: 'not_found' });

    const parsed = UpdateTermSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ code: 'bad_request', issues: parsed.error.issues });

    const dangling = danglingRefs(parsed.data.secondaryCatalogIds);
    if (dangling.length) {
      return reply.status(400).send({ code: 'dangling_ref', message: 'unknown ref target(s)', refs: dangling });
    }

    const now = Date.now();
    const jsonOrNull = (o?: Record<string, unknown> | null): string | null =>
      o && Object.keys(o).length ? JSON.stringify(o) : null;
    getDb().prepare(`
      UPDATE glossary_terms SET
        label = ?, description = ?, primary_catalog_id = ?, secondary_catalog_ids = ?,
        aliases = ?, category = ?, updated_at = ?, label_vi = ?, description_vi = ?,
        aliases_vi = ?, editor_name = ?,
        entity_cube = ?, entity_pk = ?, default_measure_ref = ?,
        default_filter_json = ?, ranking_json = ?, trust_tier = ?
      WHERE id = ?
    `).run(
      parsed.data.label,
      parsed.data.description,
      parsed.data.primaryCatalogId ?? null,
      parsed.data.secondaryCatalogIds && parsed.data.secondaryCatalogIds.length
        ? JSON.stringify(parsed.data.secondaryCatalogIds) : null,
      parsed.data.aliases && parsed.data.aliases.length ? JSON.stringify(parsed.data.aliases) : null,
      parsed.data.category ?? null,
      now,
      parsed.data.labelVi ?? null,
      parsed.data.descriptionVi ?? null,
      parsed.data.aliasesVi && parsed.data.aliasesVi.length ? JSON.stringify(parsed.data.aliasesVi) : null,
      parsed.data.editorName ?? null,
      parsed.data.entityCube ?? null,
      parsed.data.entityPk ?? null,
      parsed.data.defaultMeasureRef ?? null,
      jsonOrNull(parsed.data.defaultFilter ?? null),
      jsonOrNull(parsed.data.ranking ?? null),
      parsed.data.trustTier ?? null,
      req.params.id,
    );

    invalidateReverseIndex();
    return rowToTerm(getRowById(req.params.id) as GlossaryRow);
  });

  // Promoting a term to official/certified is an admin-only act — it gates what
  // the chat agent treats as authoritative. Editors may create/edit drafts but
  // cannot certify them; that requires an explicit admin sign-off.
  app.patch<{ Params: { id: string } }>(
    '/api/glossary/:id/status',
    { preHandler: requireRole('admin') },
    async (req, reply) => {
      const existing = getRowById(req.params.id);
      if (!existing) return reply.status(404).send({ code: 'not_found' });

      const parsed = StatusPatchSchema.safeParse(req.body ?? {});
      if (!parsed.success) return reply.status(400).send({ code: 'bad_request', issues: parsed.error.issues });

      getDb().prepare(`
        UPDATE glossary_terms SET status = ?, editor_name = COALESCE(?, editor_name), updated_at = ?
        WHERE id = ?
      `).run(parsed.data.status, parsed.data.editorName ?? null, Date.now(), req.params.id);

      invalidateReverseIndex();
      return rowToTerm(getRowById(req.params.id) as GlossaryRow);
    },
  );

  app.delete<{ Params: { id: string } }>('/api/glossary/:id', async (req, reply) => {
    const existing = getRowById(req.params.id);
    if (!existing) return reply.status(404).send({ code: 'not_found' });
    if (existing.source === 'seed') {
      return reply.status(409).send({
        code: 'seed_protected',
        message: 'cannot delete seed row; demote to draft instead',
      });
    }
    getDb().prepare(`DELETE FROM glossary_terms WHERE id = ?`).run(req.params.id);
    invalidateReverseIndex();
    return reply.status(204).send();
  });
}

export type { GlossaryTerm } from './glossary-row-mapper.js';
