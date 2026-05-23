/**
 * Composition draft types. Mirrors the schema in
 * `server/src/types/business-metric.ts` so the wizard form binds 1:1 to
 * the YAML registry shape — no translation layer.
 */

import type { BusinessMetricDomain as Domain } from '../metrics-tab/business-metric-types';

export type FormulaKind = 'measure' | 'ratio';

export interface CompositionDraft {
  id: string;
  label: string;
  description: string;
  synonyms: string[];
  tier: 1 | 2 | 3 | 4 | 5 | 6;
  domain: Domain;
  owner: string;
  formulaKind: FormulaKind;
  measureRef: string;
  ratioNumerator: string;
  ratioDenominator: string;
}

export function emptyDraft(): CompositionDraft {
  return {
    id: '',
    label: '',
    description: '',
    synonyms: [],
    tier: 3,
    domain: 'engagement',
    owner: '',
    formulaKind: 'measure',
    measureRef: '',
    ratioNumerator: '',
    ratioDenominator: '',
  };
}

export interface DraftValidation {
  ok: boolean;
  byStep: Record<number, string[]>;
  allErrors: string[];
}

const ID_RE = /^[a-z][a-z0-9_]*$/;

export function validateDraft(d: CompositionDraft): DraftValidation {
  const s1: string[] = [];
  const s2: string[] = [];
  const s3: string[] = [];
  const s4: string[] = [];

  if (d.formulaKind === 'measure') {
    if (!d.measureRef.includes('.')) s2.push('Measure ref must be `<cube>.<member>`');
  } else {
    if (!d.ratioNumerator.includes('.')) s2.push('Numerator must be `<cube>.<member>`');
    if (!d.ratioDenominator.includes('.')) s3.push('Denominator must be `<cube>.<member>`');
    if (d.ratioNumerator && d.ratioNumerator === d.ratioDenominator) {
      s3.push('Numerator and denominator must differ');
    }
  }

  if (!d.label.trim()) s4.push('Label required');
  if (!d.id.trim()) s4.push('ID required');
  else if (!ID_RE.test(d.id)) s4.push('ID must match `^[a-z][a-z0-9_]*$`');
  if (!d.owner.trim()) s4.push('Owner required');

  const byStep = { 1: s1, 2: s2, 3: s3, 4: s4 };
  const all = [...s1, ...s2, ...s3, ...s4];
  return { ok: all.length === 0, byStep, allErrors: all };
}

export function deriveIdFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+/g, '_')
    .replace(/_$/, '');
}

export function draftToYamlPayload(d: CompositionDraft): unknown {
  const base = {
    id: d.id,
    label: d.label,
    description: d.description || `${d.label} (draft)`,
    synonyms: d.synonyms,
    tier: d.tier,
    domain: d.domain,
    owner: d.owner,
    trust: 'draft',
  };
  if (d.formulaKind === 'measure') {
    return { ...base, formula: { type: 'measure', ref: d.measureRef } };
  }
  return {
    ...base,
    formula: {
      type: 'ratio',
      numerator: d.ratioNumerator,
      denominator: d.ratioDenominator,
    },
  };
}
