/**
 * Stable hash over a segment's cohort DEFINITION — the inputs that change which
 * users are in the cohort, and nothing else. Renames, tags, cadence and
 * visibility edits keep the hash; predicate edits (and uid-list rewrites on
 * manual segments) change it. Used as the cache key for derived artifacts that
 * only need recomputing when the cohort itself moves (AI brief; the snapshot
 * pull API's ETag extends this same util).
 *
 * Format: sha256 hex sliced to 16 chars (same shape as card-cache query hashes).
 */

import { createHash } from 'node:crypto';

export interface SegmentDefinitionInput {
  type: string;
  cube: string | null;
  game_id: string | null;
  /** Stored predicate tree JSON string (null for manual segments). */
  predicate_tree_json: string | null;
  /** Materialized uid list — only hashed for manual segments, where the list
   *  IS the definition. Predicate segments ignore it (refresh churn would
   *  otherwise bust caches without any definition change). */
  uid_list_json?: string | null;
}

/** Recursively sort object keys so two serializations of the same predicate
 *  tree (e.g. editor re-save vs API import) hash identically. Arrays keep
 *  order — child order in an AND/OR group is part of the definition's shape. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Parse-then-canonicalize a stored JSON string; malformed input falls back to
 *  the raw string so the hash is still deterministic (never throws). */
function canonicalJson(raw: string | null): string | null {
  if (raw == null) return null;
  try {
    return JSON.stringify(canonicalize(JSON.parse(raw)));
  } catch {
    return raw;
  }
}

export function segmentDefinitionHash(input: SegmentDefinitionInput): string {
  const basis = {
    type: input.type,
    cube: input.cube ?? null,
    game_id: input.game_id ?? null,
    predicate_tree: canonicalJson(input.predicate_tree_json),
    // The uid list defines a manual cohort; for predicate cohorts it is a
    // derived materialization and must not perturb the hash.
    uid_list: input.type === 'manual' ? canonicalJson(input.uid_list_json ?? null) : null,
  };
  return createHash('sha256').update(JSON.stringify(basis)).digest('hex').slice(0, 16);
}
