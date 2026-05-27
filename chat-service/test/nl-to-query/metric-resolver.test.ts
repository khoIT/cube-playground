/**
 * Unit tests for the unified metric resolver.
 * Covers cube-ref, exact, alias, ratio, ambiguous, and expression cases.
 */

import { describe, it, expect } from 'vitest';
import { resolveMetric } from '../../src/nl-to-query/metric-resolver.js';
import type { OfficialTerm } from '../../src/nl-to-query/types.js';

const GLOSSARY: OfficialTerm[] = [
  {
    id: 'revenue',
    label: 'Revenue',
    labelVi: 'Doanh thu',
    description: 'Total revenue.',
    primaryCatalogId: null,
    aliases: ['revenue', 'gross revenue'],
    aliasesVi: ['doanh thu'],
    category: 'monetisation',
    measureRef: 'recharge.revenue_vnd',
    refKind: 'measure',
  },
  {
    id: 'dau',
    label: 'DAU',
    labelVi: 'DAU',
    description: 'Daily active users.',
    primaryCatalogId: null,
    aliases: ['dau', 'daily active users'],
    aliasesVi: ['dau'],
    category: 'engagement',
    measureRef: 'active_daily.dau',
    refKind: 'measure',
  },
  {
    id: 'arpu',
    label: 'ARPU',
    labelVi: 'ARPU',
    description: 'Average revenue per user.',
    primaryCatalogId: null,
    aliases: ['arpu'],
    aliasesVi: ['arpu'],
    category: 'monetisation',
    measureRef: 'mf_users.arpu_vnd',
    refKind: 'measure',
  },
  {
    id: 'd7_retention',
    label: 'D7 retention',
    labelVi: 'Giữ chân D7',
    description: 'Day-7 retention.',
    primaryCatalogId: null,
    aliases: ['d7 retention', 'retention rate'],
    aliasesVi: ['giữ chân d7', 'tỷ lệ giữ chân'],
    category: 'retention',
    refKind: 'ratio',
    ratioRef: { numerator: 'retention.retained_d7', denominator: 'retention.cohort_size' },
  },
  {
    id: 'stickiness',
    label: 'Stickiness',
    labelVi: 'Độ gắn kết',
    description: 'DAU/MAU expression.',
    primaryCatalogId: null,
    aliases: ['stickiness'],
    aliasesVi: ['độ gắn kết'],
    category: 'engagement',
    refKind: 'expression',
  },
];

describe('resolveMetric', () => {
  it('cube-ref: fully-qualified cube member auto-resolves with confidence 1.0', () => {
    const members = new Set(['recharge.revenue_vnd', 'active_daily.dau']);
    const res = resolveMetric('recharge.revenue_vnd', GLOSSARY, members);
    expect(res).toBeDefined();
    expect(res?.ref).toBe('recharge.revenue_vnd');
    expect(res?.refKind).toBe('measure');
    expect(res?.confidence).toBe(1.0);
    expect(res?.matchedOn).toBe('cube-ref');
    expect(res?.termId).toBeNull();
  });

  it('exact: whole message = glossary term id/label/alias → confidence 1.0, matchedOn "exact"', () => {
    const res = resolveMetric('revenue', GLOSSARY);
    expect(res).toBeDefined();
    expect(res?.ref).toBe('recharge.revenue_vnd');
    expect(res?.refKind).toBe('measure');
    expect(res?.confidence).toBe(1.0);
    expect(res?.matchedOn).toBe('exact');
    expect(res?.termId).toBe('revenue');
  });

  it('exact: match on alias (case-insensitive)', () => {
    const res = resolveMetric('ARPU', GLOSSARY);
    expect(res).toBeDefined();
    expect(res?.ref).toBe('mf_users.arpu_vnd');
    expect(res?.confidence).toBe(1.0);
    expect(res?.matchedOn).toBe('exact');
  });

  it('alias: span match inside phrase → confidence 0.85, gap=1 when single hit', () => {
    const res = resolveMetric('show revenue last 7 days', GLOSSARY);
    expect(res).toBeDefined();
    expect(res?.ref).toBe('recharge.revenue_vnd');
    expect(res?.confidence).toBe(0.85);
    expect(res?.matchedOn).toBe('alias');
    expect(res?.gap).toBe(1);
  });

  it('ratio: d7_retention term → refKind "ratio", ratioRef set, ref null', () => {
    const res = resolveMetric('d7 retention', GLOSSARY);
    expect(res).toBeDefined();
    expect(res?.refKind).toBe('ratio');
    expect(res?.ref).toBeNull();
    expect(res?.ratioRef).toEqual({ numerator: 'retention.retained_d7', denominator: 'retention.cohort_size' });
    expect(res?.confidence).toBe(1.0);
  });

  it('ambiguous: two distinct metric terms in message → confidence 0.5, gap=0', () => {
    const res = resolveMetric('revenue vs arpu', GLOSSARY);
    expect(res).toBeDefined();
    expect(res?.confidence).toBe(0.5);
    expect(res?.gap).toBe(0);
    // One of them wins; both appear in alternatives
    expect(res?.alternatives?.length).toBeGreaterThan(0);
  });

  it('expression: stickiness term → refKind "expression", ref null, reason set', () => {
    const res = resolveMetric('stickiness', GLOSSARY);
    expect(res).toBeDefined();
    expect(res?.refKind).toBe('expression');
    expect(res?.ref).toBeNull();
    expect(res?.ratioRef).toBeNull();
    expect(res?.reason).toContain('derived expression');
  });

  it('unknown: message with no glossary hits → null', () => {
    const res = resolveMetric('xyz abc 123', GLOSSARY);
    expect(res).toBeNull();
  });
});
