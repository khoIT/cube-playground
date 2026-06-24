/**
 * Concept reverse index — derives cross-layer edges so any object can navigate
 * to the others it relates to:
 *   field   → metrics that reference it, segments that filter on it, terms that point at it
 *   metric  → terms that reference it, fields it is built from
 *   segment → terms that reference it, fields it filters on
 *
 * Derived, never stored. Computed from the live metric registry + glossary rows
 * + segment predicates, cached per (workspace, game) behind a version counter
 * that write routes bump via `invalidateReverseIndex()`. Segments are
 * workspace-scoped (owner is provenance, not a private boundary — see the
 * segments route header), so the cache key + query carry the workspace: a term
 * ref to `segments/<id>` is only dereferenced against segments inside the
 * caller's active workspace (no cross-workspace leak).
 */

import { getDb } from '../db/sqlite.js';
import { LIFECYCLE_TRACKING_OWNER } from './lifecycle-tracking-segment.js';
import { getAll as getAllMetrics } from './business-metrics-loader.js';
import { extractRefs, parseFqn } from './metric-ref-validator.js';
import { glossaryTrust, parseRef, type Trust } from './trust-mapping.js';
import { canAccessSegment } from '../auth/can-access-segment.js';
import type { Principal } from '../auth/principal.js';

export interface RelatedMetric { ref: string; id: string; label: string; trust: Trust }
export interface RelatedTerm { ref: string; id: string; label: string; trust: Trust }
export interface RelatedSegment { ref: string; id: string; name: string }
export interface RelatedField { ref: string; member: string }

export interface ConceptRelations {
  ref: string;
  fields: RelatedField[];
  metrics: RelatedMetric[];
  terms: RelatedTerm[];
  segments: RelatedSegment[];
}

interface TermRow {
  id: string;
  label: string;
  status: 'draft' | 'official';
  trust_tier: string | null;
  primary_catalog_id: string | null;
  secondary_catalog_ids: string | null;
}

interface SegmentRow {
  id: string;
  name: string;
  predicate_tree_json: string | null;
  cube_query_json: string | null;
  owner: string;
  visibility: string | null;
}

interface IndexData {
  /** metricId → cube.member fields it is built from */
  metricFields: Map<string, string[]>;
  metricMeta: Map<string, { label: string; trust: Trust }>;
  /** termId → its valid namespaced refs */
  termRefs: Map<string, string[]>;
  termMeta: Map<string, { label: string; trust: Trust }>;
  /** segmentId → cube.member fields it filters on */
  segmentFields: Map<string, string[]>;
  segmentMeta: Map<string, { name: string; owner: string; visibility: string | null }>;
}

const MEMBER_RE = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

let version = 0;
const cache = new Map<string, { version: number; data: IndexData }>();

/** Bump the reverse index so the next read recomputes. Call on any write that
 *  changes a metric, glossary term, or segment. */
export function invalidateReverseIndex(): void {
  version += 1;
}

/** Collect cube.member-shaped strings from an arbitrary parsed JSON value. */
function collectMembers(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    if (MEMBER_RE.test(value)) into.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectMembers(v, into);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectMembers(v, into);
  }
}

function segmentMembers(row: SegmentRow): string[] {
  const found = new Set<string>();
  for (const raw of [row.predicate_tree_json, row.cube_query_json]) {
    if (!raw) continue;
    try {
      collectMembers(JSON.parse(raw), found);
    } catch {
      /* malformed JSON → contributes no members */
    }
  }
  return [...found];
}

function build(workspaceId: string, gameId: string | null): IndexData {
  const metrics = getAllMetrics();
  const metricFields = new Map<string, string[]>();
  const metricMeta = new Map<string, { label: string; trust: Trust }>();
  for (const m of metrics) {
    const fields = extractRefs(m)
      .map((r) => parseFqn(r)?.fqn)
      .filter((f): f is string => !!f);
    metricFields.set(m.id, fields);
    metricMeta.set(m.id, { label: m.label, trust: m.trust as Trust });
  }

  const db = getDb();
  const termRows = db
    .prepare(
      `SELECT id, label, status, trust_tier, primary_catalog_id, secondary_catalog_ids
       FROM glossary_terms`,
    )
    .all() as TermRow[];
  const termRefs = new Map<string, string[]>();
  const termMeta = new Map<string, { label: string; trust: Trust }>();
  for (const t of termRows) {
    const refs: string[] = [];
    if (t.primary_catalog_id && parseRef(t.primary_catalog_id)) refs.push(t.primary_catalog_id);
    if (t.secondary_catalog_ids) {
      try {
        const arr = JSON.parse(t.secondary_catalog_ids);
        if (Array.isArray(arr)) for (const r of arr) if (typeof r === 'string' && parseRef(r)) refs.push(r);
      } catch {
        /* ignore */
      }
    }
    termRefs.set(t.id, refs);
    const tier = t.trust_tier === 'certified' || t.trust_tier === 'experimental' ? t.trust_tier : null;
    termMeta.set(t.id, { label: t.label, trust: glossaryTrust(t.status, tier) });
  }

  // Segments: scope by workspace (the real access boundary), then optionally by
  // game — mirrors the segments list endpoint. Never widen past the workspace.
  const segParams: string[] = [workspaceId];
  let segSql = `SELECT id, name, predicate_tree_json, cube_query_json, owner, visibility FROM segments WHERE workspace = ?`;
  // Exclude hidden system lifecycle-tracking segments — they're snapshot plumbing,
  // not user concepts, and must never surface in concept→segment reverse links.
  segSql += ' AND owner != ?';
  segParams.push(LIFECYCLE_TRACKING_OWNER);
  if (gameId) { segSql += ' AND game_id = ?'; segParams.push(gameId); }
  const segRows = db.prepare(segSql).all(...segParams) as SegmentRow[];
  const segmentFields = new Map<string, string[]>();
  const segmentMeta = new Map<string, { name: string; owner: string; visibility: string | null }>();
  for (const s of segRows) {
    segmentFields.set(s.id, segmentMembers(s));
    segmentMeta.set(s.id, { name: s.name, owner: s.owner, visibility: s.visibility });
  }

  return { metricFields, metricMeta, termRefs, termMeta, segmentFields, segmentMeta };
}

function getIndex(workspaceId: string, gameId: string | null): IndexData {
  const key = `${workspaceId}::${gameId ?? ''}`;
  const hit = cache.get(key);
  if (hit && hit.version === version) return hit.data;
  const data = build(workspaceId, gameId);
  cache.set(key, { version, data });
  return data;
}

/**
 * Cross-layer relations for one namespaced ref. Returns empty arrays for a
 * well-formed but unconnected ref; the caller decides 404 vs empty.
 */
export function getRelations(
  ref: string,
  scope: { workspaceId: string; gameId: string | null; principal: Principal },
): ConceptRelations | null {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  const idx = getIndex(scope.workspaceId, scope.gameId);
  const out: ConceptRelations = { ref, fields: [], metrics: [], terms: [], segments: [] };

  // A personal segment must never surface to a non-owner via the reverse index
  // (same predicate as the LIST/by-id routes). The index is workspace-keyed and
  // cached; per-principal visibility is filtered here at read time.
  const canSeeSegment = (id: string): boolean => {
    const meta = idx.segmentMeta.get(id);
    if (!meta) return false;
    return canAccessSegment(scope.principal, { owner: meta.owner, visibility: meta.visibility });
  };

  const metricRef = (id: string): RelatedMetric => ({
    ref: `business_metrics/${id}`,
    id,
    label: idx.metricMeta.get(id)?.label ?? id,
    trust: idx.metricMeta.get(id)?.trust ?? 'draft',
  });
  const termRef = (id: string): RelatedTerm => ({
    ref: `glossary/${id}`,
    id,
    label: idx.termMeta.get(id)?.label ?? id,
    trust: idx.termMeta.get(id)?.trust ?? 'draft',
  });
  const fieldRef = (member: string): RelatedField => ({ ref: `data_model/${member}`, member });
  const segRef = (id: string): RelatedSegment => ({
    ref: `segments/${id}`,
    id,
    name: idx.segmentMeta.get(id)?.name ?? id,
  });

  const termsReferencing = (targetRef: string): string[] =>
    [...idx.termRefs.entries()].filter(([, refs]) => refs.includes(targetRef)).map(([id]) => id);

  if (parsed.namespace === 'data_model') {
    const member = parsed.id;
    for (const [id, fields] of idx.metricFields) if (fields.includes(member)) out.metrics.push(metricRef(id));
    for (const [id, fields] of idx.segmentFields)
      if (fields.includes(member) && canSeeSegment(id)) out.segments.push(segRef(id));
    for (const id of termsReferencing(ref)) out.terms.push(termRef(id));
  } else if (parsed.namespace === 'business_metrics') {
    for (const f of idx.metricFields.get(parsed.id) ?? []) out.fields.push(fieldRef(f));
    for (const id of termsReferencing(ref)) out.terms.push(termRef(id));
  } else if (parsed.namespace === 'segments') {
    // Don't dereference another user's personal segment — return no fields.
    if (canSeeSegment(parsed.id)) {
      for (const f of idx.segmentFields.get(parsed.id) ?? []) out.fields.push(fieldRef(f));
    }
    for (const id of termsReferencing(ref)) out.terms.push(termRef(id));
  }

  return out;
}
