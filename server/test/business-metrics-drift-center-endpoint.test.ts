/**
 * Integration tests for the Drift Center endpoints:
 *   GET   /api/business-metrics/drift-center
 *   PATCH /api/business-metrics/:id/repoint
 *   PATCH /api/business-metrics/:id/applicability
 *
 * Real :memory: DB (seeded migrations), a tmp registry, stubbed /meta, and a
 * manually-decorated `req.workspace` so we can flip gameModel game_id↔prefix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../src/services/cube-client.js', () => ({
  getMeta: vi.fn(),
  getMetaWithCtx: vi.fn(),
}));

import businessMetricsDriftRoutes from '../src/routes/business-metrics-drift.js';
import { clearCache, loadAll, setRegistryDir, getById } from '../src/services/business-metrics-loader.js';
import { setDb, closeDb, getDb } from '../src/db/sqlite.js';
import { upsertDriftRows } from '../src/db/metric-drift-snapshot-store.js';
import { listAudit } from '../src/db/business-metric-audit-store.js';
import { getMetaWithCtx } from '../src/services/cube-client.js';

const metaMock = vi.mocked(getMetaWithCtx);

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
function buildDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

const META = {
  cubes: [
    { name: 'mf_users', measures: [{ name: 'mf_users.dau' }], dimensions: [] },
    { name: 'recharge', measures: [{ name: 'recharge.paying_users' }], dimensions: [{ name: 'recharge.recharge_date' }] },
    { name: 'ordered_event_funnel', measures: [{ name: 'ordered_event_funnel.step_count' }], dimensions: [] },
  ],
};

function yaml(lines: string[]): string {
  return lines.join('\n') + '\n';
}
const METRICS: Record<string, string> = {
  dau: yaml(['id: dau', 'label: DAU', 'description: d', 'tier: 1', 'domain: engagement', 'owner: data@vng', 'trust: certified', 'formula:', '  type: measure', '  ref: mf_users.dau']),
  npu: yaml(['id: npu', 'label: NPU', 'description: n', 'tier: 2', 'domain: payments', 'owner: data@vng', 'trust: draft', 'formula:', '  type: measure', '  ref: mf_users.new_users']),
  cpi: yaml(['id: cpi', 'label: CPI', 'description: c', 'tier: 3', 'domain: marketing', 'owner: data@vng', 'trust: draft', 'formula:', '  type: measure', '  ref: marketing.cost']),
  step_measure: yaml(['id: step_measure', 'label: Step', 'description: s', 'tier: 3', 'domain: engagement', 'owner: data@vng', 'trust: draft', 'formula:', '  type: measure', '  ref: funnel.step_count']),
  step_ratio: yaml(['id: step_ratio', 'label: StepRatio', 'description: s', 'tier: 3', 'domain: engagement', 'owner: data@vng', 'trust: draft', 'formula:', '  type: ratio', '  numerator: funnel.step_count', '  denominator: mf_users.dau']),
  step_expr: yaml(['id: step_expr', 'label: StepExpr', 'description: s', 'tier: 3', 'domain: engagement', 'owner: data@vng', 'trust: draft', 'formula:', '  type: expression', '  expression: "a / b"', '  inputs:', '    - funnel.step_count', '    - mf_users.dau']),
};

let dir: string;
let app: FastifyInstance;
let gameModel: 'game_id' | 'prefix' = 'game_id';

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bm-driftc-'));
  setRegistryDir(dir);
  clearCache();
  for (const [id, body] of Object.entries(METRICS)) writeFileSync(join(dir, `${id}.yml`), body);
  await loadAll();

  setDb(buildDb());
  gameModel = 'game_id';
  metaMock.mockResolvedValue(META);

  app = Fastify();
  // Decorate the request like the real workspace-header plugin would.
  app.decorateRequest('workspace', null);
  app.decorateRequest('cubeCtx', null);
  app.decorateRequest('buildCubeCtxForGame', null);
  app.addHook('onRequest', async (req) => {
    (req as any).workspace = { id: 'local', label: 'Local', cubeApiUrl: 'http://x', authMode: 'minted', gameModel };
    (req as any).cubeCtx = { cubeApiUrl: 'http://x', token: 'Bearer t' };
    (req as any).buildCubeCtxForGame = () => ({ cubeApiUrl: 'http://x', token: 'Bearer t' });
  });
  await app.register(businessMetricsDriftRoutes);
});

afterEach(async () => {
  await app.close();
  closeDb();
  clearCache();
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('GET /drift-center', () => {
  it('400 when ?game= is omitted', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/business-metrics/drift-center' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('GAME_REQUIRED');
  });

  it('groups match validateRefs minus N/A, persists live rows', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/business-metrics/drift-center?game=ballistar' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.prefixUnsupported).toBe(false);
    // cube-missing groups: funnel (step_measure/step_ratio/step_expr), marketing (cpi);
    // member-missing: mf_users.new_users (npu). dau resolves.
    const keys = body.groups.map((g: any) => g.key).sort();
    expect(keys).toEqual(['funnel', 'marketing', 'mf_users.new_users']);
    const funnel = body.groups.find((g: any) => g.key === 'funnel');
    expect(funnel.kind).toBe('cube-missing');
    expect(funnel.affectedCount).toBe(3);
    // live rows persisted under (local, ballistar, live)
    const liveRows = getDb().prepare(
      "SELECT COUNT(*) AS n FROM metric_drift_snapshot WHERE workspace_id='local' AND game='ballistar' AND source='live'",
    ).get() as { n: number };
    expect(liveRows.n).toBeGreaterThan(0);
  });

  it('prefix workspace short-circuits: prefixUnsupported true, groups []', async () => {
    gameModel = 'prefix';
    const res = await app.inject({ method: 'GET', url: '/api/business-metrics/drift-center?game=ballistar' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.prefixUnsupported).toBe(true);
    expect(body.groups).toEqual([]);
  });

  it('detectorPanel is populated separately and not merged into live groups', async () => {
    upsertDriftRows(getDb(), {
      workspaceId: 'local', game: 'ballistar', source: 'detector',
      rows: [{ metricId: 'cpi', ref: 'marketing.cost', reason: 'cube-missing' }],
    });
    const res = await app.inject({ method: 'GET', url: '/api/business-metrics/drift-center?game=ballistar' });
    const body = res.json();
    expect(body.detectorPanel.groups.length).toBeGreaterThan(0);
    expect(body.detectorPanel.groups[0].key).toBe('marketing');
    // Live groups are computed fresh (independent of the detector seed).
    expect(body.groups.find((g: any) => g.key === 'funnel')).toBeTruthy();
  });

  it('502 when /meta fetch fails', async () => {
    metaMock.mockRejectedValueOnce(new Error('cube down'));
    const res = await app.inject({ method: 'GET', url: '/api/business-metrics/drift-center?game=ballistar' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('META_FETCH_FAILED');
  });

  it('marking a metric N/A removes its group on the next read', async () => {
    await app.inject({
      method: 'PATCH', url: '/api/business-metrics/cpi/applicability',
      payload: { game: 'ballistar', applicable: false },
    });
    const res = await app.inject({ method: 'GET', url: '/api/business-metrics/drift-center?game=ballistar' });
    const keys = res.json().groups.map((g: any) => g.key);
    expect(keys).not.toContain('marketing');
  });
});

describe('PATCH /:id/repoint', () => {
  it('repoints a measure ref, writes YAML, resolves, audits', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/business-metrics/step_measure/repoint',
      payload: { from: 'funnel.step_count', to: 'ordered_event_funnel.step_count', game: 'ballistar' },
    });
    expect(res.statusCode).toBe(200);
    const m = getById('step_measure');
    expect(m?.formula).toMatchObject({ type: 'measure', ref: 'ordered_event_funnel.step_count' });
    expect(listAudit(getDb(), 'step_measure').length).toBeGreaterThan(0);
  });

  it('rewrites a ratio numerator slot', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/business-metrics/step_ratio/repoint',
      payload: { from: 'funnel.step_count', to: 'ordered_event_funnel.step_count', game: 'ballistar' },
    });
    expect(res.statusCode).toBe(200);
    expect(getById('step_ratio')?.formula).toMatchObject({
      type: 'ratio', numerator: 'ordered_event_funnel.step_count', denominator: 'mf_users.dau',
    });
  });

  it('rewrites an expression input slot', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/business-metrics/step_expr/repoint',
      payload: { from: 'funnel.step_count', to: 'ordered_event_funnel.step_count', game: 'ballistar' },
    });
    expect(res.statusCode).toBe(200);
    const f = getById('step_expr')?.formula as { type: 'expression'; inputs?: string[] };
    expect(f.inputs).toEqual(['ordered_event_funnel.step_count', 'mf_users.dau']);
  });

  it('400 REFS_UNRESOLVED when target does not resolve (backstop)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/business-metrics/step_measure/repoint',
      payload: { from: 'funnel.step_count', to: 'ordered_event_funnel.nope', game: 'ballistar' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('REFS_UNRESOLVED');
    // YAML unchanged.
    expect(getById('step_measure')?.formula).toMatchObject({ ref: 'funnel.step_count' });
  });

  it('400 FROM_NOT_FOUND when `from` is absent from the formula', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/business-metrics/step_measure/repoint',
      payload: { from: 'not.present', to: 'ordered_event_funnel.step_count', game: 'ballistar' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('FROM_NOT_FOUND');
  });

  it('404 for an unknown metric', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/business-metrics/ghost/repoint',
      payload: { from: 'a.b', to: 'mf_users.dau', game: 'ballistar' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /:id/applicability', () => {
  it('appends an applicability entry and audits', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/business-metrics/cpi/applicability',
      payload: { game: 'ballistar', applicable: false, note: 'no marketing cubes' },
    });
    expect(res.statusCode).toBe(200);
    const entries = getById('cpi')?.meta?.applicability ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ game: 'ballistar', applicable: false });
    expect(listAudit(getDb(), 'cpi').length).toBeGreaterThan(0);
  });

  it('404 for an unknown metric', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/business-metrics/ghost/applicability',
      payload: { game: 'ballistar', applicable: false },
    });
    expect(res.statusCode).toBe(404);
  });
});
