/** Frontend mirror of the server-side const tuples for filter UI. */

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
  'beta',
  'draft',
  'deprecated',
  'orphaned',
] as const;
