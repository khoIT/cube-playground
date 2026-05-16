import { describe, it, expect } from 'vitest';
import { projectMeasure } from '../project-measure';
import type { ProjectableCube, ProjectableMeasure } from '../types';

function cube(overrides: Partial<ProjectableCube> = {}): ProjectableCube {
  return {
    name: 'mf_users',
    measures: [],
    dimensions: [
      { name: 'mf_users.country', type: 'string' },
      { name: 'mf_users.user_id', type: 'string', primaryKey: true },
      { name: 'mf_users.signup_source', type: 'string' },
      { name: 'mf_users.internal_only', type: 'string', public: false },
    ],
    meta: { game_id: 'bal_vn', cdp_source: 'iceberg.ballistar_vn.mf_users' },
    ...overrides,
  };
}

function measure(overrides: Partial<ProjectableMeasure>): ProjectableMeasure {
  return { name: 'mf_users.x', aggType: 'count', ...overrides };
}

describe('projectMeasure()', () => {
  it('count → COUNT(*)', () => {
    const result = projectMeasure(cube(), measure({ name: 'mf_users.user_count', aggType: 'count' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.expression).toBe('COUNT(*)');
    expect(result.payload.filter).toBe('');
    expect(result.payload.metric_name).toBe('user_count');
    expect(result.payload.metric_codename).toBe('user_count');
    expect(result.payload.game_id).toBe('bal_vn');
    expect(result.payload.source).toBe('iceberg.ballistar_vn.mf_users');
  });

  it('sum with sql → SUM(amount)', () => {
    const result = projectMeasure(
      cube(),
      measure({ name: 'mf_users.total_amount', aggType: 'sum', sql: 'amount' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.expression).toBe('SUM(amount)');
    expect(result.payload.filter).toBe('');
  });

  it('count_distinct → COUNT(DISTINCT user_id)', () => {
    const result = projectMeasure(
      cube(),
      measure({ name: 'mf_users.distinct_users', aggType: 'count_distinct', sql: 'user_id' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.expression).toBe('COUNT(DISTINCT user_id)');
  });

  it('count_distinct_approx → approx_distinct(user_id)', () => {
    const result = projectMeasure(
      cube(),
      measure({ name: 'mf_users.approx_users', aggType: 'count_distinct_approx', sql: 'user_id' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.expression).toBe('approx_distinct(user_id)');
  });

  it('filtered measure → filter wraps each clause in parens, joined with AND', () => {
    const result = projectMeasure(
      cube(),
      measure({
        name: 'mf_users.paying_user_count',
        aggType: 'count',
        filters: [{ sql: 'is_paying=true' }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.expression).toBe('COUNT(*)');
    expect(result.payload.filter).toBe('(is_paying=true)');
  });

  it('two filters → (p1) AND (p2)', () => {
    const result = projectMeasure(
      cube(),
      measure({
        name: 'mf_users.paying_vn_users',
        aggType: 'count',
        filters: [{ sql: 'is_paying=true' }, { sql: "country='VN'" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.filter).toBe("(is_paying=true) AND (country='VN')");
  });

  it('empty filters array treated same as no filters', () => {
    const result = projectMeasure(
      cube(),
      measure({ name: 'mf_users.user_count', aggType: 'count', filters: [] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.filter).toBe('');
  });

  it('calculated measure (number type with {ref}) → not-projectable', () => {
    const result = projectMeasure(
      cube(),
      measure({
        name: 'mf_users.arpu_vnd',
        aggType: 'number',
        type: 'number',
        sql: '{lifetime_recharge_amount_vnd}/{user_count}',
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('references-other-measures');
  });

  it('no {ref} placeholder → still projectable as sum/count/etc.', () => {
    const result = projectMeasure(
      cube(),
      measure({ name: 'mf_users.constant_one', aggType: 'sum', sql: '1' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.expression).toBe('SUM(1)');
  });

  it('missing cube.meta.game_id → missing-cube-meta', () => {
    const result = projectMeasure(
      cube({ meta: { cdp_source: 'iceberg.x.y' } }),
      measure({ name: 'mf_users.user_count', aggType: 'count' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('missing-cube-meta');
  });

  it('missing cube.meta entirely → missing-cube-meta', () => {
    const result = projectMeasure(
      cube({ meta: undefined }),
      measure({ name: 'mf_users.user_count', aggType: 'count' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('missing-cube-meta');
  });

  it('view (multi-cube) → not-single-source', () => {
    const result = projectMeasure(
      cube({ type: 'view' }),
      measure({ name: 'view_x.user_count', aggType: 'count' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-single-source');
  });

  it('dimensions sorted + filtered to public !== false && !primaryKey', () => {
    const result = projectMeasure(
      cube(),
      measure({ name: 'mf_users.user_count', aggType: 'count' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.dimensions).toEqual(['country', 'signup_source']);
  });

  it('unsupported agg type → unsupported-agg-type', () => {
    const result = projectMeasure(
      cube(),
      measure({ name: 'mf_users.x', aggType: 'avg', sql: 'amount' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-agg-type');
  });

  it('count_distinct without sql → unsupported-agg-type', () => {
    const result = projectMeasure(
      cube(),
      measure({ name: 'mf_users.bad', aggType: 'count_distinct' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-agg-type');
  });

  it('dimensions deduped', () => {
    const c = cube({
      dimensions: [
        { name: 'mf_users.country', type: 'string' },
        { name: 'mf_users.country', type: 'string' },
      ],
    });
    const result = projectMeasure(c, measure({ name: 'mf_users.user_count', aggType: 'count' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.dimensions).toEqual(['country']);
  });
});
