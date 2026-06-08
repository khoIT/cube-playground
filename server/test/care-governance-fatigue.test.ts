/**
 * Phase-5 governance: fatigue evaluator (window cap + per-channel cooldown +
 * cao-priority override), KPI auto-eval resolution, SLA-breach detection, and
 * the governance/fatigue routes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { evaluateFatigue, type FatigueInput } from '../src/care/fatigue.js';
import { resolveKpiOutcome, detectSlaBreach, runKpiEval } from '../src/care/kpi-eval.js';
import { DEFAULT_GOVERNANCE } from '../src/care/care-governance-store.js';
import { openCase, patchCase, getCase } from '../src/care/care-case-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

const gov = (over: Partial<typeof DEFAULT_GOVERNANCE> = {}) => ({
  gameId: 'jus_vn',
  ...DEFAULT_GOVERNANCE,
  ...over,
});
const NOW = new Date('2026-06-08T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe('evaluateFatigue', () => {
  const base = (over: Partial<FatigueInput>): FatigueInput => ({
    recent: [],
    governance: gov(),
    channel: 'zalo_zns',
    priority: 'tb',
    now: NOW,
    ...over,
  });

  it('allows when under cap and channel off cooldown', () => {
    expect(evaluateFatigue(base({})).verdict).toBe('allow');
  });

  it('defers a non-urgent contact when the 24h cap is hit', () => {
    const r = evaluateFatigue(base({ recent: [{ treatedAt: hoursAgo(2), channel: 'call' }] }));
    expect(r.verdict).toBe('defer');
    expect(r.nextEligibleAt).toBeDefined();
  });

  it('blocks-with-override (never silently defers) an urgent cao contact over cap', () => {
    const r = evaluateFatigue(base({ priority: 'cao', recent: [{ treatedAt: hoursAgo(1), channel: 'call' }] }));
    expect(r.verdict).toBe('blocked_override');
    expect(r.reason).toMatch(/override/i);
  });

  it('nextEligibleAt clears when the N-th-newest contact ages out (cap ≥ 2)', () => {
    // cap=2, window=24h, contacts at −1h/−2h/−3h (all on different channels so
    // only the window cap bites). Cap clears when the 2nd-newest (−2h) ages out:
    // −2h + 24h = +22h from now.
    const r = evaluateFatigue(base({
      governance: gov({ maxContactsPerWindow: 2, perChannelCooldownHours: { call: 0, zalo_zns: 0, in_game: 0, push: 0 } }),
      channel: 'zalo_zns',
      recent: [
        { treatedAt: hoursAgo(1), channel: 'call' },
        { treatedAt: hoursAgo(2), channel: 'in_game' },
        { treatedAt: hoursAgo(3), channel: 'push' },
      ],
    }));
    expect(r.verdict).toBe('defer');
    const expected = new Date(NOW.getTime() + 22 * 3_600_000).toISOString();
    expect(r.nextEligibleAt).toBe(expected);
  });

  it('enforces per-channel cooldown independent of the window cap', () => {
    // Raise the cap so only the channel cooldown can bite; Zalo cooldown = 48h.
    const r = evaluateFatigue(base({
      governance: gov({ maxContactsPerWindow: 99 }),
      channel: 'zalo_zns',
      recent: [{ treatedAt: hoursAgo(10), channel: 'zalo_zns' }],
    }));
    expect(r.verdict).toBe('defer');
    // A different channel (push, 24h) with no prior push contact is allowed.
    const r2 = evaluateFatigue(base({
      governance: gov({ maxContactsPerWindow: 99 }),
      channel: 'push',
      recent: [{ treatedAt: hoursAgo(10), channel: 'zalo_zns' }],
    }));
    expect(r2.verdict).toBe('allow');
  });
});

describe('KPI eval helpers', () => {
  it('resolves met/missed against a numeric target, na for qualitative', () => {
    expect(resolveKpiOutcome('ARPU ≥ 500000', 600000)).toBe('kpi_met');
    expect(resolveKpiOutcome('ARPU ≥ 500000', 400000)).toBe('kpi_missed');
    expect(resolveKpiOutcome('second deposit within 7d', 1)).toBe('na'); // no numeric floor
    expect(resolveKpiOutcome('500000', null)).toBe('na'); // metric unknown
  });

  it('detects SLA breach when treatment lands after the deadline', () => {
    const opened = '2026-06-08T00:00:00Z';
    expect(detectSlaBreach({ opened_at: opened, treated_at: '2026-06-08T02:00:00Z' }, 60, NOW)).toBe(true); // 120m > 60m
    expect(detectSlaBreach({ opened_at: opened, treated_at: '2026-06-08T00:30:00Z' }, 60, NOW)).toBe(false); // 30m < 60m
    expect(detectSlaBreach({ opened_at: opened, treated_at: null }, undefined, NOW)).toBe(false); // no SLA
  });
});

describe('runKpiEval (idempotent resolution)', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => closeDb());

  it('resolves due treated cases and is idempotent on re-run', async () => {
    const { case: c } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'vip1', source: 'membership', kpiTarget: 'ARPU ≥ 500000' });
    patchCase(c.id, { status: 'treated', kpiEvalAt: hoursAgo(1) }); // due

    const first = await runKpiEval('jus_vn', { fetchMetricValue: async () => 600000 }, NOW);
    expect(first.evaluated).toBe(1);
    expect(first.met).toBe(1);
    expect(getCase(c.id)!.status).toBe('resolved');
    expect(getCase(c.id)!.outcome).toBe('kpi_met');

    // Re-run: the case is now resolved, no longer 'treated' → not re-evaluated.
    const second = await runKpiEval('jus_vn', { fetchMetricValue: async () => 600000 }, NOW);
    expect(second.evaluated).toBe(0);
  });

  it('does not touch treated cases whose KPI window has not elapsed', async () => {
    const { case: c } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'vip2', source: 'membership', kpiTarget: '500000' });
    patchCase(c.id, { status: 'treated', kpiEvalAt: new Date(NOW.getTime() + 3_600_000).toISOString() }); // future
    const r = await runKpiEval('jus_vn', { fetchMetricValue: async () => 1 }, NOW);
    expect(r.evaluated).toBe(0);
    expect(getCase(c.id)!.status).toBe('treated');
  });
});

describe('governance + fatigue routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    setDb(makeMemDb());
    app = await buildApp();
  });
  afterEach(async () => {
    if (app) await app.close();
    closeDb();
  });

  it('GET governance returns defaults; PUT persists; invalid game rejected', async () => {
    const def = await app.inject({ method: 'GET', url: '/api/care/governance?game=jus_vn' });
    expect(def.statusCode).toBe(200);
    expect(def.json().maxContactsPerWindow).toBe(1);

    const put = await app.inject({
      method: 'PUT',
      url: '/api/care/governance?game=jus_vn',
      payload: { maxContactsPerWindow: 2, windowHours: 48, perChannelCooldownHours: { call: 72, zalo_zns: 24, in_game: 12, push: 12 } },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().maxContactsPerWindow).toBe(2);

    const bad = await app.inject({ method: 'GET', url: '/api/care/governance?game=../etc' });
    expect(bad.statusCode).toBe(400);
  });

  it('GET fatigue returns a verdict for a proposed outreach', async () => {
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'vipA', source: 'membership' });
    // No treated contacts yet → allow.
    const res = await app.inject({ method: 'GET', url: '/api/care/fatigue?game=jus_vn&uid=vipA&channel=call&priority=tb' });
    expect(res.statusCode).toBe(200);
    expect(res.json().verdict).toBe('allow');

    const badChannel = await app.inject({ method: 'GET', url: '/api/care/fatigue?game=jus_vn&uid=vipA&channel=carrier-pigeon' });
    expect(badChannel.statusCode).toBe(400);
  });
});
