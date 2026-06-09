/**
 * Shared zod schemas for VIP-care playbook request bodies.
 *
 * The threshold-rule and PredicateNode shapes are validated by BOTH the
 * authoring routes (create/patch an override) and the preview-count route
 * (count a candidate condition against live Cube). Keeping one definition
 * means a count previews exactly the shape the authoring route would persist —
 * the two can't drift.
 */

import { z } from 'zod';

export const thresholdRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('abs'), member: z.string().min(1), op: z.enum(['gt', 'lt', 'gte', 'lte', 'equals']), value: z.number(), valueType: z.enum(['string', 'number', 'time', 'boolean']).optional() }),
  z.object({ kind: z.literal('tierStep'), member: z.string().min(1), bands: z.array(z.object({ label: z.string(), min: z.number() })).min(1) }),
  z.object({ kind: z.literal('event'), member: z.string().min(1), window: z.string().min(1), op: z.enum(['in', 'notIn']).optional() }),
  z.object({ kind: z.literal('percentile'), of: z.string().min(1), p: z.number().min(0).max(100), gate: z.string().optional(), op: z.enum(['gte', 'lte']).optional() }),
  z.object({ kind: z.literal('ratio'), member: z.string().min(1), vs: z.string().min(1), value: z.number(), op: z.enum(['gt', 'lt', 'gte', 'lte']) }),
]);

export const watchedMetricSchema = z.object({ member: z.string(), label: z.string(), kpiTarget: z.string().optional() });
export const actionSchema = z.object({ text: z.string(), channels: z.array(z.string()), slaMinutes: z.number().optional() });

// Optional AND/OR filter layered on the threshold condition — same PredicateNode
// shape segments store. Recursive (groups nest), so defined via z.lazy.
const leafOps = [
  'equals', 'notEquals', 'gt', 'lt', 'gte', 'lte', 'in', 'notIn',
  'contains', 'set', 'notSet', 'inDateRange', 'notInDateRange', 'beforeDate', 'afterDate',
] as const;

export const predicateNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('leaf'),
      id: z.string(),
      member: z.string().min(1),
      type: z.enum(['string', 'number', 'time', 'boolean']),
      op: z.enum(leafOps),
      values: z.array(z.unknown()),
    }),
    z.object({
      kind: z.literal('group'),
      id: z.string(),
      op: z.enum(['AND', 'OR']),
      children: z.array(predicateNodeSchema),
    }),
  ]),
);
