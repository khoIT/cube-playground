/**
 * Scaffolder tests: additive → clean yaml; mixed → drops non-additive w/ warning;
 * dteventtime → build_range_end cap; log_date → no cap; unmatchable → no yaml;
 * identity dim dropped; name collision → _v2; no plan/phase refs in output.
 */

import { describe, it, expect } from 'vitest';
import { scaffoldRollupDraft } from '../src/services/rollup-yaml-scaffolder.js';
import type { QueryShape } from '../src/services/query-perf-store.js';

const shape = (over: Partial<QueryShape> = {}): QueryShape => ({
  cubes: ['active_daily'], measures: ['active_daily.dau'], dimensions: ['active_daily.log_date'], ...over,
});

describe('scaffoldRollupDraft', () => {
  it('additive + DATE time-dim → clean yaml, no build_range_end cap', () => {
    const { yaml, warnings } = scaffoldRollupDraft(shape(), { matchability: 'matchable' });
    expect(yaml).toContain('pre_aggregations:');
    expect(yaml).toContain('active_daily_batch:');
    expect(yaml).toContain('measures: [dau]');
    expect(yaml).toContain('time_dimension: log_date');
    expect(yaml).not.toContain('build_range_end');
    expect(warnings).toHaveLength(0);
  });

  it('timestamp time-dim (dteventtime) → emits build_range_end LEAST cap', () => {
    const { yaml } = scaffoldRollupDraft(
      shape({ dimensions: ['active_daily.dteventtime', 'active_daily.country'] }),
      { matchability: 'matchable' },
    );
    expect(yaml).toContain('time_dimension: dteventtime');
    expect(yaml).toContain('build_range_end');
    expect(yaml).toContain('LEAST(MAX(dteventtime), current_timestamp)');
    expect(yaml).toContain('dimensions: [country]');
  });

  it('mixed measures → drops non-additive with a warning', () => {
    const { yaml, warnings } = scaffoldRollupDraft(
      shape({ measures: ['active_daily.dau', 'active_daily.avg_session'] }),
      { matchability: 'matchable' },
    );
    expect(yaml).toContain('measures: [dau]');
    expect(yaml).not.toContain('avg_session');
    expect(warnings.join(' ')).toContain('non-additive');
  });

  it('unmatchable → no yaml + explanatory warning', () => {
    const { yaml, warnings } = scaffoldRollupDraft(
      { cubes: ['mf_users'], measures: ['mf_users.count'], dimensions: ['mf_users.user_id'] },
      { matchability: 'unmatchable' },
    );
    expect(yaml).toBeNull();
    expect(warnings.join(' ')).toContain('cannot be served by a rollup');
  });

  it('identity dim dropped from grouping with a warning', () => {
    const { yaml, warnings } = scaffoldRollupDraft(
      shape({ dimensions: ['active_daily.log_date', 'active_daily.user_id', 'active_daily.country'] }),
      { matchability: 'matchable' },
    );
    expect(yaml).toContain('dimensions: [country]');
    expect(yaml).not.toContain('user_id');
    expect(warnings.join(' ')).toContain('per-user dimensions excluded');
  });

  it('name collision → _v2 suffix', () => {
    const { yaml } = scaffoldRollupDraft(shape(), {
      matchability: 'matchable',
      existingRollupNames: new Set(['active_daily_batch']),
    });
    expect(yaml).toContain('active_daily_batch_v2:');
  });

  it('emitted YAML contains no plan/phase references', () => {
    const { yaml } = scaffoldRollupDraft(shape(), { matchability: 'matchable' })!;
    expect(yaml).not.toMatch(/phase|P[0-9]|plan\b/i);
  });

  it('no additive measures → no yaml', () => {
    const { yaml, warnings } = scaffoldRollupDraft(
      shape({ measures: ['active_daily.avg_session'] }),
      { matchability: 'matchable' },
    );
    expect(yaml).toBeNull();
    expect(warnings.join(' ')).toContain('No additive measures');
  });
});
