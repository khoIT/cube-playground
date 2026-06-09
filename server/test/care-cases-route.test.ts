/**
 * Care-case ledger routes: list / by-vip (priority-ranked, deduped) / vip-history
 * / patch lifecycle, plus game-param validation (allow-list + path-traversal guard).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/index.js';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { openCase } from '../src/care/care-case-store.js';
import { upsertVipProfiles } from '../src/care/care-vip-profile-store.js';
import { signAppJwt } from '../src/services/app-jwt.js';
import { __resetAccessCache } from '../src/auth/access-store.js';
import { upsertUserAccess } from '../src/auth/access-store-mutators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

describe('care-case ledger routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    setDb(makeMemDb());
    app = await buildApp();
  });
  afterEach(async () => {
    if (app) await app.close();
    closeDb();
  });

  it('rejects an invalid game id (path-traversal guard)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/care/cases?game=../../etc/passwd' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown game', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/care/cases?game=not_a_game' });
    expect(res.statusCode).toBe(400);
  });

  it('lists cases and dedupes by VIP with top-priority ranking', async () => {
    // whale matches 02 (cao) + 14 (cao); minnow matches 14 only.
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'whale', source: 'membership' });
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '14', uid: 'whale', source: 'membership' });
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '18', uid: 'minnow', source: 'membership' }); // 18 = thap

    const list = await app.inject({ method: 'GET', url: '/api/care/cases?game=jus_vn' });
    expect(list.statusCode).toBe(200);
    expect(list.json().cases).toHaveLength(3);

    const byVip = await app.inject({ method: 'GET', url: '/api/care/cases/by-vip?game=jus_vn' });
    const vips = byVip.json().vips;
    expect(vips).toHaveLength(2);
    // whale (cao, 2 cases) ranks before minnow (thap, 1 case).
    expect(vips[0].uid).toBe('whale');
    expect(vips[0].caseCount).toBe(2);
    expect(vips[0].topPriority).toBe('cao');
  });

  it('patches a case to treated and reflects in vip history', async () => {
    const { case: c } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'vip1', source: 'membership' });
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/care/cases/${c.id}`,
      payload: { status: 'treated', channel_used: 'call', action_taken: 'tier benefits' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().status).toBe('treated');
    expect(patch.json().treated_at).not.toBeNull();

    const hist = await app.inject({ method: 'GET', url: '/api/care/cases/vip/vip1?game=jus_vn' });
    const cases = hist.json().cases;
    expect(cases[0].playbook_name).toBe('VIP tier reached');
    expect(cases[0].channel_used).toBe('call');
  });

  it('404 on patching a missing case', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/care/cases/nope', payload: { status: 'treated' } });
    expect(res.statusCode).toBe(404);
  });

  it('sweep rejects an invalid game before touching Cube', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/care/cases/sweep?game=../../etc' });
    expect(res.statusCode).toBe(400);
  });

  it('by-vip and list attach the persisted VIP profile (no live Cube)', async () => {
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'whale', source: 'membership' });
    upsertVipProfiles('jus_vn', 'local', [
      { uid: 'whale', name: 'BigSpender', ltvVnd: 944_000_000, tier: 'Diamond', daysSinceLastActive: 5, lastRechargeDate: null },
    ]);

    const byVip = await app.inject({ method: 'GET', url: '/api/care/cases/by-vip?game=jus_vn' });
    const vip = byVip.json().vips[0];
    expect(vip.uid).toBe('whale');
    expect(vip.profile).toMatchObject({ name: 'BigSpender', ltvVnd: 944_000_000, tier: 'Diamond', churnPlayDays: 5 });

    const list = await app.inject({ method: 'GET', url: '/api/care/cases?game=jus_vn' });
    expect(list.json().cases[0].profile.name).toBe('BigSpender');
  });

  it('omits the profile (null) for an un-swept VIP', async () => {
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'nobody', source: 'membership' });
    const byVip = await app.inject({ method: 'GET', url: '/api/care/cases/by-vip?game=jus_vn' });
    expect(byVip.json().vips[0].profile).toBeNull();
  });

  it('paginates by-vip: 50/page envelope, urgent on page 1, disjoint pages', async () => {
    // 60 low-priority VIPs (18 = thap) + one high-priority (02 = cao). The cao
    // VIP must surface on page 1 row 1 regardless of insertion order.
    for (let i = 0; i < 60; i++) {
      openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '18', uid: `low${String(i).padStart(3, '0')}`, source: 'membership' });
    }
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'whale', source: 'membership' });

    const p1 = await app.inject({ method: 'GET', url: '/api/care/cases/by-vip?game=jus_vn&page=1&pageSize=50' });
    const b1 = p1.json();
    expect(b1.total).toBe(61);
    expect(b1.page).toBe(1);
    expect(b1.pageSize).toBe(50);
    expect(b1.vips).toHaveLength(50);
    expect(b1.vips[0].uid).toBe('whale'); // cao ranks first, survives the slice
    expect(b1.vips[0].topPriority).toBe('cao');

    const p2 = await app.inject({ method: 'GET', url: '/api/care/cases/by-vip?game=jus_vn&page=2&pageSize=50' });
    const b2 = p2.json();
    expect(b2.vips).toHaveLength(11); // 61 - 50
    const overlap = new Set(b1.vips.map((v: { uid: string }) => v.uid));
    expect(b2.vips.some((v: { uid: string }) => overlap.has(v.uid))).toBe(false);
  });

  it('returns the FULL list when no page param (CS Monitor aggregates) — not capped at 50', async () => {
    for (let i = 0; i < 60; i++) {
      openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '18', uid: `u${String(i).padStart(3, '0')}`, source: 'membership' });
    }
    const res = await app.inject({ method: 'GET', url: '/api/care/cases?game=jus_vn' });
    const b = res.json();
    expect(b.cases).toHaveLength(60); // un-paginated: every case, so aggregates stay correct
    expect(b.total).toBe(60);
  });

  it('list rows carry the matched playbook name + priority (for the pill)', async () => {
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'whale', source: 'membership' });
    const res = await app.inject({ method: 'GET', url: '/api/care/cases?game=jus_vn' });
    const c = res.json().cases[0];
    expect(c.playbook_name).toBe('VIP tier reached');
    expect(c.playbook_priority).toBeTruthy();
  });

  it('filters cases by a comma-list of playbooks', async () => {
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'a', source: 'membership' });
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '14', uid: 'b', source: 'membership' });
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '18', uid: 'c', source: 'membership' });

    const res = await app.inject({ method: 'GET', url: '/api/care/cases?game=jus_vn&playbook=02,14' });
    const ids = res.json().cases.map((c: { playbook_id: string }) => c.playbook_id).sort();
    expect(ids).toEqual(['02', '14']);
  });

  it('filters cases by a comma-list of statuses; rejects a bad token', async () => {
    const { case: t } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'a', source: 'membership' });
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '14', uid: 'b', source: 'membership' }); // stays 'new'
    await app.inject({ method: 'PATCH', url: `/api/care/cases/${t.id}`, payload: { status: 'treated' } });

    const ok = await app.inject({ method: 'GET', url: '/api/care/cases?game=jus_vn&status=new,treated' });
    expect(ok.json().cases).toHaveLength(2);

    const onlyTreated = await app.inject({ method: 'GET', url: '/api/care/cases?game=jus_vn&status=treated' });
    expect(onlyTreated.json().cases).toHaveLength(1);
    expect(onlyTreated.json().cases[0].status).toBe('treated');

    const bad = await app.inject({ method: 'GET', url: '/api/care/cases?game=jus_vn&status=new,bogus' });
    expect(bad.statusCode).toBe(400);
  });

  it('by-vip q= searches uid AND display name', async () => {
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'uid_alpha', source: 'membership' });
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'uid_beta', source: 'membership' });
    upsertVipProfiles('jus_vn', 'local', [
      { uid: 'uid_alpha', name: 'Dragon Lord', ltvVnd: 1, tier: 'Gold', daysSinceLastActive: 1, lastRechargeDate: null },
    ]);

    // by uid substring
    const byUid = await app.inject({ method: 'GET', url: '/api/care/cases/by-vip?game=jus_vn&q=beta&page=1&pageSize=50' });
    expect(byUid.json().vips.map((v: { uid: string }) => v.uid)).toEqual(['uid_beta']);
    expect(byUid.json().total).toBe(1);

    // by name substring (case-insensitive) — must match even though name lives in the profile
    const byName = await app.inject({ method: 'GET', url: '/api/care/cases/by-vip?game=jus_vn&q=dragon&page=1&pageSize=50' });
    expect(byName.json().vips.map((v: { uid: string }) => v.uid)).toEqual(['uid_alpha']);
  });

  it('clamps pageSize to [1,200] and defaults page to 1', async () => {
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'whale', source: 'membership' });
    const res = await app.inject({ method: 'GET', url: '/api/care/cases/by-vip?game=jus_vn&page=0&pageSize=9999' });
    const b = res.json();
    expect(b.page).toBe(1);
    expect(b.pageSize).toBe(200);
  });
});

// Auth-enabled surface: the write-role gate must block viewers from mutating
// the ledger (the AUTH_DISABLED default-on suite can't catch this).
describe('care-case PATCH write-role gate (real auth)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prev = { AUTH_DISABLED: process.env.AUTH_DISABLED, JWT_SECRET: process.env.JWT_SECRET };
  const JWT_SECRET = 'test-jwt-secret-must-be-at-least-16-chars';
  const tok = (sub: string, email: string, role: 'viewer' | 'editor' | 'admin') =>
    signAppJwt({ sub, username: sub, email, role });
  let caseId: string;

  beforeEach(async () => {
    process.env.AUTH_DISABLED = 'false';
    process.env.JWT_SECRET = JWT_SECRET;
    setDb(makeMemDb());
    __resetAccessCache();
    upsertUserAccess({ email: 'viewer@corp.com', role: 'viewer', status: 'active' });
    upsertUserAccess({ email: 'editor@corp.com', role: 'editor', status: 'active' });
    app = await buildApp();
    caseId = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'vip1', source: 'membership' }).case.id;
  });
  afterEach(async () => {
    process.env.AUTH_DISABLED = prev.AUTH_DISABLED;
    process.env.JWT_SECRET = prev.JWT_SECRET;
    if (app) await app.close();
    closeDb();
  });

  it('viewer cannot PATCH a case (403); editor can (200)', async () => {
    const viewer = { authorization: `Bearer ${await tok('v', 'viewer@corp.com', 'viewer')}` };
    const editor = { authorization: `Bearer ${await tok('e', 'editor@corp.com', 'editor')}` };

    const denied = await app.inject({ method: 'PATCH', url: `/api/care/cases/${caseId}`, headers: viewer, payload: { status: 'treated' } });
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject({ method: 'PATCH', url: `/api/care/cases/${caseId}`, headers: editor, payload: { status: 'treated' } });
    expect(ok.statusCode).toBe(200);

    // Viewer can still READ the monitor/ledger (GET unaffected).
    const read = await app.inject({ method: 'GET', url: '/api/care/cases?game=jus_vn', headers: viewer });
    expect(read.statusCode).toBe(200);
  });

  it('viewer cannot trigger a sweep (403, mutating)', async () => {
    const viewer = { authorization: `Bearer ${await tok('v', 'viewer@corp.com', 'viewer')}` };
    const res = await app.inject({ method: 'POST', url: '/api/care/cases/sweep?game=jus_vn', headers: viewer });
    expect(res.statusCode).toBe(403);
  });
});
