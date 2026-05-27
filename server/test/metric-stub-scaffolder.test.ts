/**
 * Unit tests for the draft-stub scaffolder.
 */
import { describe, expect, it } from 'vitest';

import { scaffoldDraftMetric } from '../src/services/metric-stub-scaffolder.js';
import { BusinessMetricSchema } from '../src/types/business-metric.js';

describe('scaffoldDraftMetric', () => {
  it('builds a Zod-valid draft from a measure ref', () => {
    const { metric, id } = scaffoldDraftMetric('active_daily.wau');
    expect(id).toBe('wau');
    expect(metric.trust).toBe('draft');
    expect(metric.tier).toBe(3);
    expect(metric.formula).toEqual({ type: 'measure', ref: 'active_daily.wau' });
    expect(metric.game_compatibility?.required_cubes).toEqual(['active_daily']);
    expect(metric.label).toBe('Wau');
    // Must pass the schema unchanged so it can go straight through writeMetric.
    expect(() => BusinessMetricSchema.parse(metric)).not.toThrow();
  });

  it('infers domain from the ref keywords', () => {
    expect(scaffoldDraftMetric('user_recharge_daily.trailing_wpu').metric.domain).toBe('payments');
    expect(scaffoldDraftMetric('marketing.cost_vnd').metric.domain).toBe('marketing');
    expect(scaffoldDraftMetric('retention.retained_d7').metric.domain).toBe('retention');
    expect(scaffoldDraftMetric('active_daily.some_count').metric.domain).toBe('engagement');
  });

  it('suffixes the id on collision', () => {
    const taken = new Set(['wau']);
    expect(scaffoldDraftMetric('active_daily.wau', taken).id).toBe('wau_2');
  });

  it('throws on an unparseable ref', () => {
    expect(() => scaffoldDraftMetric('nodot')).toThrow(/unparseable/);
  });
});
