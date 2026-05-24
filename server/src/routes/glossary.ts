/**
 * Glossary endpoint:
 *   GET /api/glossary       — list all canonical terms (seeded at boot)
 *   GET /api/glossary/:id   — single term lookup
 *
 * Read-only over `glossary_terms`. Chat-side override storage (phase-11)
 * extends but does not replace this surface.
 */

import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/sqlite.js';

interface GlossaryRow {
  id: string;
  label: string;
  description: string;
  primary_catalog_id: string | null;
  secondary_catalog_ids: string | null;
  aliases: string | null;
  category: string | null;
  updated_at: number;
}

export interface GlossaryTerm {
  id: string;
  label: string;
  description: string;
  primaryCatalogId: string | null;
  secondaryCatalogIds: string[];
  aliases: string[];
  category: string | null;
  updatedAt: string;
}

function rowToTerm(row: GlossaryRow): GlossaryTerm {
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    primaryCatalogId: row.primary_catalog_id,
    secondaryCatalogIds: safeArray(row.secondary_catalog_ids),
    aliases: safeArray(row.aliases),
    category: row.category,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function safeArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export default async function glossaryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/glossary', async () => {
    const rows = getDb()
      .prepare(`SELECT * FROM glossary_terms ORDER BY label COLLATE NOCASE ASC`)
      .all() as GlossaryRow[];
    return { terms: rows.map(rowToTerm) };
  });

  app.get<{ Params: { id: string } }>('/api/glossary/:id', async (req, reply) => {
    const row = getDb()
      .prepare(`SELECT * FROM glossary_terms WHERE id = ?`)
      .get(req.params.id) as GlossaryRow | undefined;
    if (!row) return reply.status(404).send({ code: 'not_found' });
    return rowToTerm(row);
  });
}
