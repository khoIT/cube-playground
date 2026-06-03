/**
 * Pure row <-> wire mapping helpers for the glossary endpoints.
 * Kept separate so the routes file stays under the 200-LOC budget and
 * the seed migrator can reuse `safeArray` without pulling in Fastify deps.
 */

import {
  glossaryTrust,
  GLOSSARY_VISIBILITY,
  type Trust,
  type Visibility,
} from '../services/trust-mapping.js';

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
  // Phase 02a concept-tier columns (additive, nullable).
  entity_cube: string | null;
  entity_pk: string | null;
  default_measure_ref: string | null;
  default_filter_json: string | null;
  ranking_json: string | null;
  trust_tier: string | null;
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
  entityCube: string | null;
  entityPk: string | null;
  defaultMeasureRef: string | null;
  defaultFilter: Record<string, unknown> | null;
  ranking: Record<string, unknown> | null;
  trustTier: 'certified' | 'experimental' | null;
  // Unified trust/visibility ladder, DERIVED from the legacy status/trustTier
  // columns via trust-mapping (the stored `trust`/`visibility` columns added in
  // migration 027 stay reserved for a later flagged cutover). Glossary terms are
  // an org-wide vocabulary, so visibility is always 'org'.
  trust: Trust;
  visibility: Visibility;
  // Derived on read from the catalog formula — NOT stored columns. `rowToTerm`
  // emits null/'unknown' defaults; the list/by-id routes enrich them via
  // `deriveMeasureRef` (the catalog loader is boot-cached there).
  measureRef: string | null;
  ratioRef: { numerator: string; denominator: string } | null;
  refKind: 'measure' | 'ratio' | 'expression' | 'unknown';
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

function safeObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
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
    entityCube: row.entity_cube,
    entityPk: row.entity_pk,
    defaultMeasureRef: row.default_measure_ref,
    defaultFilter: safeObject(row.default_filter_json),
    ranking: safeObject(row.ranking_json),
    trustTier:
      row.trust_tier === 'certified' || row.trust_tier === 'experimental'
        ? row.trust_tier
        : null,
    trust: glossaryTrust(
      row.status,
      row.trust_tier === 'certified' || row.trust_tier === 'experimental' ? row.trust_tier : null,
    ),
    visibility: GLOSSARY_VISIBILITY,
    // Defaults; enriched by the route via deriveMeasureRef (loader-aware).
    measureRef: null,
    ratioRef: null,
    refKind: 'unknown',
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
  // Phase 02a concept-tier fields (additive; ignored when concept route off).
  entityCube?: string | null;
  entityPk?: string | null;
  defaultMeasureRef?: string | null;
  defaultFilter?: Record<string, unknown> | null;
  ranking?: Record<string, unknown> | null;
  trustTier?: 'certified' | 'experimental' | null;
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

function jsonOrNull(o?: Record<string, unknown> | null): string | null {
  return o && Object.keys(o).length ? JSON.stringify(o) : null;
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
    p.entityCube ?? null,
    p.entityPk ?? null,
    p.defaultMeasureRef ?? null,
    jsonOrNull(p.defaultFilter),
    jsonOrNull(p.ranking),
    p.trustTier ?? null,
  ];
}
