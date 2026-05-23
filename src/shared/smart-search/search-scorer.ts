/**
 * Local substring scorer. Weights tuned to match Compass `searchConcepts()`:
 *   label exact     1.0
 *   label prefix    0.8
 *   synonym match   0.7
 *   description     0.3
 *   FQN substring   0.5
 * Type boosts are additive (small bumps for business metrics).
 *
 * Pure function; no React, no async. Easy to test, easy to swap for an
 * embeddings-backed engine later.
 */

import type { BusinessMetric } from '../../pages/Catalog/metrics-tab/business-metric-types';
import type { Concept } from '../../pages/Catalog/data-model-tab/concept-types';
import type { SearchResult } from './search-types';

const W_LABEL_EXACT = 1.0;
const W_LABEL_PREFIX = 0.8;
const W_SYNONYM = 0.7;
const W_FQN = 0.5;
const W_DESCRIPTION = 0.3;
const BUSINESS_METRIC_BOOST = 0.05;

function scoreMetric(q: string, m: BusinessMetric): number {
  const label = m.label.toLowerCase();
  if (label === q) return W_LABEL_EXACT + BUSINESS_METRIC_BOOST;
  if (label.startsWith(q)) return W_LABEL_PREFIX + BUSINESS_METRIC_BOOST;

  let s = 0;
  if (label.includes(q)) s = Math.max(s, W_LABEL_PREFIX * 0.75);
  if ((m.synonyms ?? []).some((syn) => syn.toLowerCase().includes(q))) {
    s = Math.max(s, W_SYNONYM);
  }
  if (m.description?.toLowerCase().includes(q)) {
    s = Math.max(s, W_DESCRIPTION);
  }
  if (m.id.toLowerCase().includes(q)) {
    s = Math.max(s, W_LABEL_PREFIX * 0.6);
  }
  return s > 0 ? s + BUSINESS_METRIC_BOOST : 0;
}

function scoreConcept(q: string, c: Concept): number {
  const fqn = c.fqn.toLowerCase();
  const name = c.name.toLowerCase();

  if (name === q) return W_LABEL_EXACT;
  if (name.startsWith(q)) return W_LABEL_PREFIX;

  let s = 0;
  if (name.includes(q)) s = Math.max(s, W_LABEL_PREFIX * 0.75);
  if (fqn.includes(q)) s = Math.max(s, W_FQN);
  if (c.description?.toLowerCase().includes(q)) {
    s = Math.max(s, W_DESCRIPTION);
  }
  if (c.title?.toLowerCase().includes(q)) {
    s = Math.max(s, W_DESCRIPTION);
  }
  return s;
}

export interface ScoreInputs {
  metrics: BusinessMetric[];
  concepts: Concept[];
}

const MAX_RESULTS = 25;

export function scoreAll(query: string, pool: ScoreInputs): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results: SearchResult[] = [];

  for (const m of pool.metrics) {
    const s = scoreMetric(q, m);
    if (s > 0) {
      results.push({
        kind: 'metric',
        id: m.id,
        label: m.label,
        sublabel: m.synonyms?.join(', ') || m.description || m.id,
        routeTo: `/catalog/metric/${m.id}`,
        score: s,
      });
    }
  }

  for (const c of pool.concepts) {
    const s = scoreConcept(q, c);
    if (s > 0) {
      results.push({
        kind: 'concept',
        id: `${c.type}:${c.fqn}`,
        label: c.fqn,
        sublabel: c.description ?? c.title ?? c.type,
        routeTo: `/catalog/concept/${c.type}/${encodeURIComponent(c.fqn)}`,
        score: s,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, MAX_RESULTS);
}
