/**
 * Segment-without-metric → deterministic default metric.
 *
 * A segment/time question that names no metric ("show Minnow last 7 days")
 * binds the segment filter but leaves the metric empty, so the turn used to
 * clarify → no chart. The extractor now fills it: money cue → Revenue, else
 * active-user count — gated to a question that anchors intent (filter and/or
 * explicit time) so a contentless message still clarifies.
 */

import { describe, it, expect } from 'vitest';
import { extractSlots } from '../../src/nl-to-query/slot-extractor.js';
import type { OfficialTerm } from '../../src/nl-to-query/types.js';

function term(p: Partial<OfficialTerm> & { id: string; label: string }): OfficialTerm {
  return {
    description: '',
    primaryCatalogId: null,
    aliases: [],
    aliasesVi: [],
    labelVi: null,
    category: null,
    measureRef: null,
    ratioRef: null,
    refKind: 'measure',
    entityCube: null,
    entityPk: null,
    defaultFilter: null,
    ...p,
  } as OfficialTerm;
}

const GLOSSARY: OfficialTerm[] = [
  term({ id: 'active-user', label: 'Active Users', category: 'engagement', aliases: ['dau'], measureRef: 'active_daily.dau' }),
  term({ id: 'revenue', label: 'Revenue', category: 'monetisation', aliases: ['revenue'], measureRef: 'user_recharge_daily.revenue_vnd_total' }),
  term({
    id: 'whale', label: 'Whale', category: 'segments', aliases: ['whale'],
    measureRef: 'mf_users.user_count',
    defaultFilter: { member: 'mf_users.payer_tier', op: '=', value: 'whale' },
  }),
  term({
    id: 'minnow', label: 'Minnow', category: 'segments', aliases: ['minnow'],
    measureRef: 'mf_users.user_count',
    defaultFilter: { member: 'mf_users.payer_tier', op: '=', value: 'minnow' },
  }),
];

const KNOWN = new Set<string>([
  'active_daily.dau', 'mf_users.payer_tier', 'mf_users.user_count',
  'user_recharge_daily.revenue_vnd_total',
]);

const run = (message: string) =>
  extractSlots({ message, isVietnameseContext: false, now: Date.now(), glossary: GLOSSARY, knownMembers: KNOWN });

describe('default-metric injection', () => {
  it('bare segment + time → active-user count + segment filter', () => {
    const { slots } = run('show Minnow last 7 days');
    expect(slots.metric.value).toBe('active_daily.dau');
    expect(slots.metric.confidence).toBeGreaterThanOrEqual(0.75);
    expect(slots.filters?.some((f) => f.member === 'mf_users.payer_tier' && f.values.includes('minnow'))).toBe(true);
  });

  it('money cue → Revenue default instead of population', () => {
    const { slots } = run('Whale revenue this month');
    expect(slots.metric.value).toBe('user_recharge_daily.revenue_vnd_total');
    expect(slots.filters?.some((f) => f.values.includes('whale'))).toBe(true);
  });

  it('segment + time, no money cue → active-user count', () => {
    expect(run('Whale this month').slots.metric.value).toBe('active_daily.dau');
  });

  it('does NOT default a contentless message (no filter, no time)', () => {
    expect(run('asdf qwer').slots.metric.value).toBeUndefined();
  });

  it('does NOT override an explicitly named metric', () => {
    // "revenue" resolves on its own — default injection must not touch it.
    expect(run('revenue last 30 days').slots.metric.value).toBe('user_recharge_daily.revenue_vnd_total');
  });

  it('emits a disclosure warning when it defaults', () => {
    const { warnings } = run('show Minnow last 7 days');
    expect(warnings.some((w) => /defaulted to/i.test(w))).toBe(true);
  });
});
