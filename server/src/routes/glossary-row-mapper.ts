/**
 * Pure row <-> wire mapping helpers for the glossary endpoints.
 * Kept separate so the routes file stays under the 200-LOC budget and
 * the seed migrator can reuse `safeArray` without pulling in Fastify deps.
 */

export interface GlossaryRow {
  id: string;
  label: string;
  description: string;
  primary_catalog_id: string | null;
  secondary_catalog_ids: string | null;
  aliases: string | null;
  category: string | null;
  updated_at: number;
  label_vi: string | null;
  description_vi: string | null;
  aliases_vi: string | null;
  status: 'draft' | 'official';
  source: 'seed' | 'user';
  editor_name: string | null;
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
  labelVi: string | null;
  descriptionVi: string | null;
  aliasesVi: string[];
  status: 'draft' | 'official';
  source: 'seed' | 'user';
  editorName: string | null;
}

export function safeArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export function rowToTerm(row: GlossaryRow): GlossaryTerm {
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    primaryCatalogId: row.primary_catalog_id,
    secondaryCatalogIds: safeArray(row.secondary_catalog_ids),
    aliases: safeArray(row.aliases),
    category: row.category,
    updatedAt: new Date(row.updated_at).toISOString(),
    labelVi: row.label_vi,
    descriptionVi: row.description_vi,
    aliasesVi: safeArray(row.aliases_vi),
    status: row.status,
    source: row.source,
    editorName: row.editor_name,
  };
}

export interface TermInput {
  id?: string;
  label: string;
  description: string;
  primaryCatalogId?: string | null;
  secondaryCatalogIds?: string[];
  aliases?: string[];
  category?: string | null;
  labelVi?: string | null;
  descriptionVi?: string | null;
  aliasesVi?: string[];
  editorName?: string | null;
}

const SLUG_RE = /[^a-z0-9]+/g;

export function slugify(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(SLUG_RE, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export interface WriteRowParams extends TermInput {
  id: string;
  status: 'draft' | 'official';
  source: 'seed' | 'user';
  updatedAt: number;
}

/** Flatten domain object into the positional params our prepared INSERT/UPDATE expects. */
export function termToWriteParams(p: WriteRowParams): Array<string | number | null> {
  return [
    p.id,
    p.label,
    p.description,
    p.primaryCatalogId ?? null,
    p.secondaryCatalogIds && p.secondaryCatalogIds.length ? JSON.stringify(p.secondaryCatalogIds) : null,
    p.aliases && p.aliases.length ? JSON.stringify(p.aliases) : null,
    p.category ?? null,
    p.updatedAt,
    p.labelVi ?? null,
    p.descriptionVi ?? null,
    p.aliasesVi && p.aliasesVi.length ? JSON.stringify(p.aliasesVi) : null,
    p.status,
    p.source,
    p.editorName ?? null,
  ];
}
