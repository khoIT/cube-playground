/**
 * Derives a glossary term's canonical cube-member reference from its catalog
 * entry at glossary-read time. The catalog YAML's `formula` is the single
 * source of truth: a measure formula yields one cube member, a ratio formula
 * yields a numerator/denominator member pair, an expression yields neither.
 *
 * WHY this exists: the chat agent's /meta validator only accepts cube members,
 * but glossary terms store a catalog path (`business_metrics/revenue`). Resolving
 * the path → `formula.ref` here lets every catalog-backed term carry a real
 * member without per-term seed editing — the resolver and the validator finally
 * speak the same vocabulary.
 */

import type { BusinessMetric } from '../types/business-metric.js';

export type RefKind = 'measure' | 'ratio' | 'expression' | 'unknown';

export interface DerivedRef {
  /** Single cube member for measure-backed terms; null otherwise. */
  measureRef: string | null;
  /** Numerator/denominator members for ratio-backed terms; null otherwise. */
  ratioRef: { numerator: string; denominator: string } | null;
  refKind: RefKind;
}

type GetById = (id: string) => BusinessMetric | undefined;

/**
 * Strip a leading `<dir>/` segment so `business_metrics/revenue` → `revenue`,
 * while a bare `revenue` passes through unchanged. The catalog id is the last
 * path segment.
 */
function toCatalogId(primaryCatalogId: string): string {
  const slash = primaryCatalogId.lastIndexOf('/');
  return slash >= 0 ? primaryCatalogId.slice(slash + 1) : primaryCatalogId;
}

/**
 * Resolve `{ measureRef, ratioRef, refKind }` for one term.
 *
 * Precedence: an explicit `default_measure_ref` override beats the derived
 * formula (it is already a cube member). A missing catalog entry or absent
 * loader degrades to `refKind:'unknown'` — never throws, so a cold loader
 * cache or a seed pointing at a catalog id with no YAML cannot break the list.
 */
export function deriveMeasureRef(
  primaryCatalogId: string | null,
  defaultMeasureRef: string | null,
  getById?: GetById,
): DerivedRef {
  if (defaultMeasureRef) {
    return { measureRef: defaultMeasureRef, ratioRef: null, refKind: 'measure' };
  }
  if (!primaryCatalogId || !getById) {
    return { measureRef: null, ratioRef: null, refKind: 'unknown' };
  }

  const metric = getById(toCatalogId(primaryCatalogId));
  if (!metric) {
    return { measureRef: null, ratioRef: null, refKind: 'unknown' };
  }

  const formula = metric.formula;
  if (formula.type === 'measure') {
    return { measureRef: formula.ref, ratioRef: null, refKind: 'measure' };
  }
  if (formula.type === 'ratio') {
    return {
      measureRef: null,
      ratioRef: { numerator: formula.numerator, denominator: formula.denominator },
      refKind: 'ratio',
    };
  }
  // expression — no single member derivable yet; the resolver clarifies.
  return { measureRef: null, ratioRef: null, refKind: 'expression' };
}
