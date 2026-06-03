/**
 * ConceptNode — the node model for the standalone concept-map page.
 *
 * This is a NEW index, deliberately separate from `useCartographerIndex`
 * (which is hard-bound to Cube members: its `kind: 'segment'` means a *Cube
 * YAML segment*, keyed by cube FQN). Here we span all 4 concept layers and
 * disambiguate cube members (`field`) from app `segments` table rows
 * (`appSegment`). Do NOT fold this into the cartographer index.
 *
 * Every node is keyed by its globally-unique namespaced ref
 * (`<namespace>/<id>`), which matches exactly the refs the relations endpoint
 * emits (`server/src/services/concept-reverse-index.ts`) so edge targets
 * resolve back to a node via `byRef`. The ref also doubles as the reactflow
 * node id downstream.
 */

import type { Trust } from '../../../api/glossary-client';

/** The 4 concept layers rendered as columns. */
export type ConceptLayer = 'field' | 'metric' | 'term' | 'appSegment';

/** Server-side relation namespaces (mirrors the relations endpoint grammar). */
export type ConceptNamespace =
  | 'data_model'
  | 'business_metrics'
  | 'glossary'
  | 'segments';

/**
 * A single concept node. `kind` discriminates the layer; `trust` is present
 * for metrics + terms (real ladder value) and constant-`certified` for app
 * segments (certified-by-construction, mirroring the relations panel). Fields
 * carry no trust (read-only data-model members).
 */
export interface ConceptNode {
  kind: ConceptLayer;
  /** Globally-unique namespaced ref, e.g. "data_model/mf_users.dau". */
  ref: string;
  /** Human label shown on the card. */
  label: string;
  /** Secondary line (mono FQN for fields, category/domain hints elsewhere). */
  sublabel?: string;
  /** Trust ladder — set for metric/term/appSegment; omitted for fields. */
  trust?: Trust;
}

// ── Ref builders ───────────────────────────────────────────────────────────
// Keep these the single source of ref construction so node refs always match
// the server's relation refs (data_model/<fqn>, business_metrics/<id>,
// glossary/<id>, segments/<id>).

export const makeFieldRef = (fqn: string): string => `data_model/${fqn}`;
export const makeMetricRef = (id: string): string => `business_metrics/${id}`;
export const makeTermRef = (id: string): string => `glossary/${id}`;
export const makeSegmentRef = (id: string): string => `segments/${id}`;

/**
 * Splits a namespaced ref into `{ namespace, id }`. The id may contain dots or
 * slashes (FQNs), so we split on the FIRST slash only — same rule as
 * `getConceptRelations`. Returns null for a bare ref with no slash.
 */
export function parseConceptRef(
  ref: string,
): { namespace: string; id: string } | null {
  const slashIdx = ref.indexOf('/');
  if (slashIdx === -1) return null;
  return { namespace: ref.slice(0, slashIdx), id: ref.slice(slashIdx + 1) };
}

/**
 * The existing detail route for a node's concept, reusing the exact `to=`
 * targets the relations panel uses (`concept-relations-section.tsx`). Fields are
 * data-model members with no standalone detail page → null.
 */
export function conceptDetailRoute(node: ConceptNode): string | null {
  const parsed = parseConceptRef(node.ref);
  if (!parsed) return null;
  const id = encodeURIComponent(parsed.id);
  switch (node.kind) {
    case 'metric':
      return `/catalog/metric/${id}`;
    case 'term':
      return `/catalog/glossary#${id}`;
    case 'appSegment':
      return `/segments/${id}`;
    default:
      return null;
  }
}

/** Maps a relation namespace to its layer, or null for an unknown namespace. */
export function layerForNamespace(namespace: string): ConceptLayer | null {
  switch (namespace) {
    case 'data_model':
      return 'field';
    case 'business_metrics':
      return 'metric';
    case 'glossary':
      return 'term';
    case 'segments':
      return 'appSegment';
    default:
      return null;
  }
}
