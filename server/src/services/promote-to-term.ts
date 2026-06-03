/**
 * Promotes a segment into a draft glossary term.
 *
 * The segment's predicate becomes the term's `default_filter` where the
 * predicate is a simple leaf node (single member/op/values triple). Compound
 * predicates are stored as a `segments/<id>` secondary ref so the relation is
 * preserved even when we cannot express the full logic in the filter grammar.
 *
 * Enters as trust=draft, status='draft', source='user'. The caller is
 * responsible for auth and workspace scoping before calling this.
 */

import { slugify } from '../routes/glossary-row-mapper.js';
import { isValidRef } from './trust-mapping.js';
import type { PredicateNode } from '../types/predicate-tree.js';

export interface SegmentForPromotion {
  id: string;
  name: string;
  cube: string | null;
  predicate_tree: PredicateNode | null;
  game_id: string;
}

/** Filter shape that the glossary default_filter column accepts (single-clause). */
export interface GlossaryFilter {
  member: string;
  op: '>' | '>=' | '<' | '<=' | '=' | '!=' | 'IN' | 'NOT IN';
  value: string | number | Array<string | number>;
}

const OP_MAP: Record<string, GlossaryFilter['op'] | undefined> = {
  equals: '=',
  notEquals: '!=',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
  in: 'IN',
  notIn: 'NOT IN',
};

/**
 * Try to extract a single-clause default_filter from a predicate tree.
 * Returns null when the predicate is compound (AND/OR group) or uses an
 * unmappable operator — the caller falls back to a segments/<id> secondary ref.
 */
function extractSimpleFilter(node: PredicateNode | null): GlossaryFilter | null {
  if (!node || node.kind !== 'leaf') return null;
  const op = OP_MAP[node.op];
  if (!op) return null;
  const vals = node.values as Array<string | number>;
  const value: GlossaryFilter['value'] =
    op === 'IN' || op === 'NOT IN' ? vals : (vals[0] ?? '');
  return { member: node.member, op, value };
}

export interface PromoteToTermInput {
  id?: string;
  label: string;
  description: string;
  primaryCatalogId?: string | null;
  secondaryCatalogIds?: string[];
  defaultFilter?: GlossaryFilter | null;
  defaultMeasureRef?: string | null;
  entityCube?: string | null;
  editorName?: string | null;
}

/**
 * Derives the glossary term draft input from a segment row.
 * Pure — no I/O. The route layer handles persistence.
 */
export function buildTermDraftFromSegment(seg: SegmentForPromotion): PromoteToTermInput {
  const id = slugify(seg.name) || `seg_${seg.id.slice(0, 8)}`;
  const segRef = `segments/${seg.id}`;

  // Validate before adding — isValidRef ensures grammar compliance.
  const secondaryCatalogIds: string[] = isValidRef(segRef) ? [segRef] : [];

  const simpleFilter = extractSimpleFilter(seg.predicate_tree);

  return {
    id,
    label: seg.name,
    description: `Draft term promoted from segment "${seg.name}". Review and curate before certifying.`,
    entityCube: seg.cube ?? null,
    secondaryCatalogIds,
    defaultFilter: simpleFilter,
    defaultMeasureRef: null,
    editorName: null,
  };
}
