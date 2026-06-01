/**
 * Classifies a glossary term into the slot it fills. Shared by the metric
 * resolver (which ranks metric-class hits) and the slot extractor (which
 * sorts dimension / filter hits) so both agree on what counts as a "metric".
 */

import type { OfficialTerm } from './types.js';

export type TermClass = 'metric' | 'dimension' | 'filter' | 'comparison';

export function classifyTerm(term: OfficialTerm): TermClass {
  // Normalise so singular/plural seed categories ('segment' vs 'segments')
  // map to the same class — a mismatch here silently routes a segment value
  // (whale/dolphin/minnow) into the metric slot, where it leaks an
  // unresolvable ref into the /meta gate.
  const cat = (term.category ?? '').toLowerCase().replace(/s$/, '');
  if (cat === 'segment' || cat === 'user') return 'filter';
  if (cat === 'comparison') return 'comparison';
  if (cat === 'dimension' || cat === 'attribute') return 'dimension';
  return 'metric';
}
