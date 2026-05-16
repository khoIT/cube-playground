import { describe, it, expect, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { router, hydrateFromSeed } from '../cdp-mock-middleware';
import type { Store, MetricRecord } from '../cdp-mock-handlers';
import seedData from '../cdp-mock-seed.json' with { type: 'json' };

type CapturedResponse = { status: number; body: unknown };

async function call(store: Store, method: string, url: string, body?: unknown): Promise<CapturedResponse> {
  const buf = body == null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const req: any = Readable.from(buf.length === 0 ? [] : [buf]);
  req.method = method;
  req.url = url;
  req.headers = { 'content-type': 'application/json' };
  const captured: CapturedResponse = { status: 0, body: undefined };
  const res: any = {
    headersSent: false,
    writeHead(s: number) { captured.status = s; this.headersSent = true; },
    end(payload?: string) {
      try { captured.body = payload ? JSON.parse(payload) : null; } catch { captured.body = payload; }
    },
  };
  await router(store)(req, res);
  return captured;
}

let store: Store;

beforeEach(() => {
  store = new Map();
  hydrateFromSeed(store, seedData as { metrics: MetricRecord[] });
});

describe('cdp-mock-middleware router', () => {
  it('seed loads ≥ 5 records, one per agg type + mismatch', () => {
    expect(store.size).toBeGreaterThanOrEqual(5);
  });

  it('GET /metrics/bal_vn → list w/ pagination', async () => {
    const r = await call(store, 'GET', '/metrics/bal_vn');
    expect(r.status).toBe(200);
    const body = r.body as { status: string; data: unknown[]; pagination: { total: number } };
    expect(body.status).toBe('SUCCESS');
    expect(body.data.length).toBeGreaterThanOrEqual(5);
    expect(body.pagination.total).toBe(body.data.length);
  });

  it('GET /metrics/bal_vn?metrics=user_count,paying_user_count → filtered', async () => {
    const r = await call(store, 'GET', '/metrics/bal_vn?metrics=user_count,paying_user_count');
    expect(r.status).toBe(200);
    const body = r.body as { data: Array<{ metric_name: string }> };
    expect(body.data.map((m) => m.metric_name).sort()).toEqual(['paying_user_count', 'user_count']);
  });

  it('GET /metrics/unknown → 404 GAME_NOT_FOUND', async () => {
    const r = await call(store, 'GET', '/metrics/unknown_game');
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ status: 'ERROR', error: { code: 'GAME_NOT_FOUND' } });
  });

  it('GET /metrics/bal_vn/user_count → 200 count match', async () => {
    const r = await call(store, 'GET', '/metrics/bal_vn/user_count');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'SUCCESS', data: { metric_name: 'user_count', expression: 'COUNT(*)' } });
  });

  it('GET /metrics/bal_vn/total_revenue_vnd → 200 sum match', async () => {
    const r = await call(store, 'GET', '/metrics/bal_vn/total_revenue_vnd');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ data: { expression: 'SUM(revenue_vnd)' } });
  });

  it('GET /metrics/bal_vn/distinct_country_count → 200 count_distinct match', async () => {
    const r = await call(store, 'GET', '/metrics/bal_vn/distinct_country_count');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ data: { expression: 'COUNT(DISTINCT country)' } });
  });

  it('GET /metrics/bal_vn/approx_distinct_user_count → 200 count_distinct_approx match', async () => {
    const r = await call(store, 'GET', '/metrics/bal_vn/approx_distinct_user_count');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ data: { expression: 'approx_distinct(user_id)' } });
  });

  it('GET /metrics/bal_vn/paying_user_count → 200 filtered variant', async () => {
    const r = await call(store, 'GET', '/metrics/bal_vn/paying_user_count');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ data: { filter: '(is_paying=true)' } });
  });

  it('GET /metrics/bal_vn/lifetime_recharge_amount_vnd → 200 with deliberate mismatch expression', async () => {
    const r = await call(store, 'GET', '/metrics/bal_vn/lifetime_recharge_amount_vnd');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ data: { expression: 'SUM(amount_usd)' } });
  });

  it('GET /metrics/bal_vn/nope → 404 METRIC_NOT_FOUND', async () => {
    const r = await call(store, 'GET', '/metrics/bal_vn/nope');
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ error: { code: 'METRIC_NOT_FOUND' } });
  });

  it('GET /metrics/bal_vn/total → 200 with count ≥ 5', async () => {
    const r = await call(store, 'GET', '/metrics/bal_vn/total');
    expect(r.status).toBe(200);
    const body = r.body as { data: { game_id: string; total_metrics: number } };
    expect(body.data.game_id).toBe('bal_vn');
    expect(body.data.total_metrics).toBeGreaterThanOrEqual(5);
  });

  it('POST /metrics with valid body → 200 + SUCCESS; subsequent GET returns it', async () => {
    const post = await call(store, 'POST', '/metrics', {
      game_id: 'bal_vn',
      metric_name: 'brand_new',
      metric_codename: 'brand_new',
      source: 'iceberg.ballistar_vn.mf_users',
      expression: 'COUNT(*)',
      dimensions: ['country'],
      filter: '',
    });
    expect(post.status).toBe(200);
    expect(post.body).toMatchObject({ status: 'SUCCESS', data: { metric_name: 'brand_new' } });

    const get = await call(store, 'GET', '/metrics/bal_vn/brand_new');
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({ data: { metric_name: 'brand_new' } });
  });

  it('POST /metrics duplicate (game_id, metric_name) → 409 METRIC_EXISTED', async () => {
    const r = await call(store, 'POST', '/metrics', {
      game_id: 'bal_vn',
      metric_name: 'user_count',
      metric_codename: 'user_count',
      source: 'iceberg.ballistar_vn.mf_users',
      expression: 'COUNT(*)',
      dimensions: [],
    });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: { code: 'METRIC_EXISTED' } });
  });

  it('POST /metrics missing metric_name → 400 INVALID_REQUEST', async () => {
    const r = await call(store, 'POST', '/metrics', {
      game_id: 'bal_vn',
      metric_codename: 'x',
      source: 's',
      expression: 'COUNT(*)',
    });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  });

  it('unknown route → 404 NOT_FOUND', async () => {
    const r = await call(store, 'GET', '/something/weird');
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('request without Authorization header still succeeds (no 401 path)', async () => {
    const r = await call(store, 'GET', '/metrics/bal_vn/user_count');
    expect(r.status).toBe(200);
  });

  it('matching seed records align with projectMeasure() output (drift guard)', async () => {
    const { projectMeasure } = await import('../../src/pages/Catalog/cdp-projection/project-measure');
    const cube = {
      name: 'mf_users',
      measures: [],
      dimensions: [
        { name: 'mf_users.country', type: 'string' },
        { name: 'mf_users.signup_source', type: 'string' },
        { name: 'mf_users.user_id', type: 'string', primaryKey: true },
      ],
      meta: { game_id: 'bal_vn', cdp_source: 'iceberg.ballistar_vn.mf_users' },
    } as const;

    const cases = [
      { measure: { name: 'mf_users.user_count', aggType: 'count' }, seedName: 'user_count' },
      { measure: { name: 'mf_users.total_revenue_vnd', aggType: 'sum', sql: 'revenue_vnd' }, seedName: 'total_revenue_vnd' },
      { measure: { name: 'mf_users.distinct_country_count', aggType: 'count_distinct', sql: 'country' }, seedName: 'distinct_country_count' },
      { measure: { name: 'mf_users.approx_distinct_user_count', aggType: 'count_distinct_approx', sql: 'user_id' }, seedName: 'approx_distinct_user_count' },
      {
        measure: { name: 'mf_users.paying_user_count', aggType: 'count', filters: [{ sql: 'is_paying=true' }] },
        seedName: 'paying_user_count',
      },
    ];

    for (const c of cases) {
      const projection = projectMeasure(cube, c.measure);
      expect(projection.ok).toBe(true);
      if (!projection.ok) continue;
      const seedRecord = store.get(`bal_vn:${c.seedName}` as const)!;
      expect(seedRecord, `seed missing ${c.seedName}`).toBeDefined();
      expect(seedRecord.expression).toBe(projection.payload.expression);
      expect(seedRecord.filter).toBe(projection.payload.filter);
      expect(seedRecord.source).toBe(projection.payload.source);
      expect(seedRecord.metric_codename).toBe(projection.payload.metric_codename);
      expect([...seedRecord.dimensions].sort()).toEqual([...projection.payload.dimensions].sort());
      expect(projection.payload.dimensions).toEqual(['country', 'signup_source']);
    }

    const mismatchProjection = projectMeasure(cube, {
      name: 'mf_users.lifetime_recharge_amount_vnd',
      aggType: 'sum',
      sql: 'lifetime_recharge_amount_vnd',
    });
    expect(mismatchProjection.ok).toBe(true);
    if (mismatchProjection.ok) {
      const seedRecord = store.get('bal_vn:lifetime_recharge_amount_vnd' as const)!;
      expect(seedRecord.expression).not.toBe(mismatchProjection.payload.expression);
    }
  });
});
