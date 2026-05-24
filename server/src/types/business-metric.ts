/**
 * Business-metric registry types.
 *
 * One YAML file per metric in `server/src/presets/business-metrics/<id>.yml`.
 * Zod schema is the single source of truth; both server and frontend re-use
 * the inferred TS type by importing this module.
 */

import { z } from 'zod';

const ID_RE = /^[a-z][a-z0-9_]*$/;

export const DOMAINS = [
  'revenue',
  'engagement',
  'acquisition',
  'retention',
  'payments',
  'concurrency',
  'marketing',
] as const;

export const TRUST_TIERS = [
  'certified',
  'draft',
  'deprecated',
] as const;

const FormulaRatio = z.object({
  type: z.literal('ratio'),
  numerator: z.string().min(1),
  denominator: z.string().min(1),
});

const FormulaMeasureRef = z.object({
  type: z.literal('measure'),
  ref: z.string().min(1),
});

const FormulaExpression = z.object({
  type: z.literal('expression'),
  expression: z.string().min(1),
  inputs: z.array(z.string().min(1)).optional(),
});

export const BusinessMetricFormulaSchema = z.discriminatedUnion('type', [
  FormulaRatio,
  FormulaMeasureRef,
  FormulaExpression,
]);

export const BusinessMetricParameterSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1).optional(),
  options: z.array(z.union([z.string(), z.number()])),
  default: z.union([z.string(), z.number()]).optional(),
});

export const BusinessMetricGameCompatSchema = z.object({
  required_cubes: z.array(z.string().min(1)),
});

export const ANOMALY_STATES = ['none', 'low', 'high', 'trend'] as const;

const BreakdownRow = z.object({
  label: z.string().min(1),
  deltaPct: z.number(),
});

export const BusinessMetricAnomalySchema = z.object({
  state: z.enum(ANOMALY_STATES),
  deltaPct: z.number().optional(),
  period: z.string().optional(),
  breakdowns: z
    .object({
      country: z.array(BreakdownRow).optional(),
      channel: z.array(BreakdownRow).optional(),
      tier: z.array(BreakdownRow).optional(),
    })
    .optional(),
});

export const TrustHistoryEntrySchema = z.object({
  trust: z.enum(TRUST_TIERS),
  at: z.string().datetime(),
  actor: z.string().min(1).optional(),
  note: z.string().max(280).optional(),
});

export const BusinessMetricMetaSchema = z
  .object({
    game_id: z.string().min(1).optional(),
    trust_history: z.array(TrustHistoryEntrySchema).optional(),
  })
  .passthrough();

export const BusinessMetricSchema = z.object({
  id: z.string().regex(ID_RE),
  label: z.string().min(1),
  description: z.string().min(1),
  synonyms: z.array(z.string()).optional(),
  tier: z.number().int().min(1).max(6),
  domain: z.enum(DOMAINS),
  owner: z.string().min(1),
  trust: z.enum(TRUST_TIERS),
  formula: BusinessMetricFormulaSchema,
  game_compatibility: BusinessMetricGameCompatSchema.optional(),
  parameter: BusinessMetricParameterSchema.optional(),
  related_concepts: z.array(z.string()).optional(),
  unit: z.string().optional(),
  format: z.string().optional(),
  anomaly: BusinessMetricAnomalySchema.optional(),
  meta: BusinessMetricMetaSchema.optional(),
});

export type BusinessMetric = z.infer<typeof BusinessMetricSchema>;
export type BusinessMetricDomain = (typeof DOMAINS)[number];
export type BusinessMetricTrust = (typeof TRUST_TIERS)[number];
export type BusinessMetricFormula = z.infer<typeof BusinessMetricFormulaSchema>;
export type BusinessMetricParameter = z.infer<typeof BusinessMetricParameterSchema>;
export type BusinessMetricGameCompat = z.infer<typeof BusinessMetricGameCompatSchema>;
export type BusinessMetricAnomalyState = (typeof ANOMALY_STATES)[number];
export type BusinessMetricAnomaly = z.infer<typeof BusinessMetricAnomalySchema>;
export type TrustHistoryEntry = z.infer<typeof TrustHistoryEntrySchema>;
export type BusinessMetricMeta = z.infer<typeof BusinessMetricMetaSchema>;
