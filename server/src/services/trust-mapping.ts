/**
 * Single source of truth for the unified trust/visibility ladder and the typed
 * namespaced-ref grammar that the glossary "concept hub" uses.
 *
 * Two orthogonal axes on every artifact:
 *   trust      ∈ {draft, certified, deprecated}  — matches business-metric trust
 *   visibility ∈ {personal, shared, org}
 *
 * The three legacy vocabularies (metric `trust`, glossary `status`+`trustTier`,
 * segments none) collapse into these here. Reads derive the unified values from
 * legacy columns — no row rewrite required — so legacy reads stay unbroken.
 */

export const TRUST_VALUES = ['draft', 'certified', 'deprecated'] as const;
export type Trust = (typeof TRUST_VALUES)[number];

export const VISIBILITY_VALUES = ['personal', 'shared', 'org'] as const;
export type Visibility = (typeof VISIBILITY_VALUES)[number];

/**
 * Glossary legacy → unified trust.
 *   experimental tier      → draft  (not yet trustworthy regardless of status)
 *   official (non-experimental) → certified
 *   draft                  → draft
 */
export function glossaryTrust(
  status: 'draft' | 'official',
  trustTier: 'certified' | 'experimental' | null,
): Trust {
  if (trustTier === 'experimental') return 'draft';
  return status === 'official' ? 'certified' : 'draft';
}

/** Glossary terms are a global, org-wide vocabulary. */
export const GLOSSARY_VISIBILITY: Visibility = 'org';

/**
 * Segments are user-built facts (a predicate that either matches rows or does
 * not), so their trust is `certified` by construction; visibility defaults to
 * `personal` to exactly preserve today's owner-only access (sharing is opt-in).
 */
export const SEGMENT_TRUST: Trust = 'certified';
export const SEGMENT_DEFAULT_VISIBILITY: Visibility = 'personal';

/** Metric visibility defaults to org when the YAML omits the key. */
export function metricVisibility(visibility?: string | null): Visibility {
  return visibility === 'personal' || visibility === 'shared' ? visibility : 'org';
}

// ── Typed namespaced refs (reuse the secondaryCatalogIds grammar) ──────────────

export const REF_NAMESPACES = ['business_metrics', 'data_model', 'segments'] as const;
export type RefNamespace = (typeof REF_NAMESPACES)[number];

// `<namespace>/<id>` — id allows dots (cube.member) but never a path traversal.
const REF_RE = /^(business_metrics|data_model|segments)\/[A-Za-z0-9._-]+$/;

export function isValidRef(ref: string): boolean {
  return REF_RE.test(ref) && !ref.includes('..');
}

export interface ParsedRef {
  namespace: RefNamespace;
  id: string;
}

export function parseRef(ref: string): ParsedRef | null {
  if (!isValidRef(ref)) return null;
  const slash = ref.indexOf('/');
  return {
    namespace: ref.slice(0, slash) as RefNamespace,
    id: ref.slice(slash + 1),
  };
}
