/**
 * Metric draft-stub scaffolder.
 *
 * Turns an uncovered Cube measure ref (`cube.member`) into a *draft*
 * BusinessMetric a human can curate. We never auto-promote: `trust:draft`,
 * a placeholder description, and an inferred (best-effort) domain. The output
 * is Zod-valid so it can go straight through the normal atomic writer.
 *
 * Pure — no I/O. The route layer handles dedup + persistence.
 */

import {
  BusinessMetricSchema,
  DOMAINS,
  type BusinessMetric,
  type BusinessMetricDomain,
} from '../types/business-metric.js';
import { parseFqn } from './metric-ref-validator.js';

const ID_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Best-effort domain from the measure/cube name. `domain` is a required enum
 * with no generic bucket, so we map keywords to the closest tier and fall
 * back to `engagement`. The human curates this when promoting the draft.
 */
function inferDomain(ref: string): BusinessMetricDomain {
  const s = ref.toLowerCase();
  const rules: Array<[RegExp, BusinessMetricDomain]> = [
    [/recharge|pay|pu\b|revenue|rev_|arpu|arppu|whale/, 'payments'],
    [/cost|install|click|impression|campaign|roas|cpi|cpn|ctr|marketing/, 'marketing'],
    [/retain|retention|cohort|recall/, 'retention'],
    [/ccu|pcu|acu|lcu|concurrent/, 'concurrency'],
    [/nru|nra|new_user|register|acquisition/, 'acquisition'],
    [/rev\b|gross|booking|trans/, 'revenue'],
  ];
  for (const [re, domain] of rules) {
    if (re.test(s) && DOMAINS.includes(domain)) return domain;
  }
  return 'engagement';
}

/** `active_daily.trailing_wau` → `Trailing Wau`. */
function toLabel(member: string): string {
  return member
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Slugify a measure name into a valid metric id (`^[a-z][a-z0-9_]*$`). */
function toId(member: string): string {
  let id = member.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!ID_RE.test(id)) id = `m_${id}`.replace(/[^a-z0-9_]+/g, '_');
  return id;
}

export interface ScaffoldResult {
  metric: BusinessMetric;
  /** id the caller should check for collision before writing. */
  id: string;
}

/**
 * Build a draft metric stub for one measure ref. `takenIds` lets the caller
 * pre-seed existing ids so we can suffix on collision (`wau` → `wau_2`).
 * Throws if `ref` isn't a parseable `cube.member`.
 */
export function scaffoldDraftMetric(ref: string, takenIds: Set<string> = new Set()): ScaffoldResult {
  const parsed = parseFqn(ref);
  if (!parsed) throw new Error(`unparseable measure ref: "${ref}"`);

  let id = toId(parsed.member);
  if (takenIds.has(id)) {
    let n = 2;
    while (takenIds.has(`${id}_${n}`)) n++;
    id = `${id}_${n}`;
  }

  const metric: BusinessMetric = {
    id,
    label: toLabel(parsed.member),
    description: `Draft — scaffolded from ${ref}. Review and curate before promoting.`,
    tier: 3,
    domain: inferDomain(ref),
    owner: 'data-platform@vng',
    trust: 'draft',
    formula: { type: 'measure', ref },
    format: 'compact',
    game_compatibility: { required_cubes: [parsed.cube] },
  };

  // Guarantee the stub is valid so it can go straight through writeMetric.
  return { metric: BusinessMetricSchema.parse(metric), id };
}
