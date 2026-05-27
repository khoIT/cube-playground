/**
 * Classifies a glossary term into the slot it fills. Shared by the metric
 * resolver (which ranks metric-class hits) and the slot extractor (which
 * sorts dimension / filter hits) so both agree on what counts as a "metric".
 */

import type { OfficialTerm } from './types.js';

export type TermClass = 'metric' | 'dimension' | 'filter' | 'comparison';

export function classifyTerm(term: OfficialTerm): TermClass {
  const cat = (term.category ?? '').toLowerCase();
  if (cat === 'segment' || cat === 'user') return 'filter';
  if (cat === 'comparison') return 'comparison';
  if (cat === 'dimension' || cat === 'attribute') return 'dimension';
  return 'metric';
}
