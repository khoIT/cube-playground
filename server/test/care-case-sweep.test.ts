/**
 * Phase-1 sweep driver: drives the engine over a game's resolved playbooks with
 * an injected cohort fetcher (no Cube). Verifies membership playbooks open cases,
 * trigger/unavailable/disabled playbooks are skipped with a reason, and a
 * re-sweep is idempotent.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, closeDb } from '../src/db/sqlite.js';
import { runCaseSweep, type SweepDeps } from '../src/care/care-case-sweep.js';
import { listCases } from '../src/care/care-case-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

// jus-like member set: payment + churn modeled, no gameplay/event tables.
const JUS_MEMBERS = new Set<string>([
  'mf_users.first_recharge_date',
  'mf_users.ltv_total_vnd',
  'mf_users.days_since_last_active',
  'mf_users.first_active_date',
  'user_recharge_daily.revenue_vnd',
  'user_recharge_daily.log_date',
  'active_daily.online_time_sec',
  'active_daily.log_date',
]);

beforeEach(() => setDb(makeMemDb()));
afterEach(() => closeDb());

describe('runCaseSweep', () => {
  it('opens cases for membership playbooks, skips trigger/unavailable with a reason', async () => {
    // Every membership playbook gets the same 2-uid cohort.
    const deps: SweepDeps = { fetchCohortUids: async () => ['u1', 'u2'] };
    const summaries = await runCaseSweep('jus_vn', 'local', JUS_MEMBERS, deps);

    const byId = Object.fromEntries(summaries.map((s) => [s.playbookId, s]));
    // 02 VIP tier (tierStep → membership, available) opens cases.
    expect(byId['02'].opened).toBe(2);
    // 04 spend-drop now reads the rolling mart (user_recharge_rolling), absent for
    // jus → unavailable (membership rule, but no source cube).
    expect(byId['04'].skipped).toBe('unavailable');
    // 06 leaderboard requires gameplay cube absent for jus → unavailable.
    expect(byId['06'].skipped).toBe('unavailable');
    // 05 payment-failure is blocked → unavailable.
    expect(byId['05'].skipped).toBe('unavailable');

    // 14 no-login (abs → membership, available) also opened.
    expect(byId['14'].opened).toBe(2);
    expect(listCases({ gameId: 'jus_vn', playbookId: '14' })).toHaveLength(2);
  });

  it('fails closed on a predicate that compiles to an empty filter (no full-cohort match)', async () => {
    // Track which playbooks actually reach the cohort query.
    const fetched: string[] = [];
    const deps: SweepDeps = {
      fetchCohortUids: async (pb) => {
        fetched.push(pb.id);
        return ['u1', 'u2'];
      },
    };
    const summaries = await runCaseSweep('jus_vn', 'local', JUS_MEMBERS, deps);
    const byId = Object.fromEntries(summaries.map((s) => [s.playbookId, s]));

    // 19 Pre-patch uses window 'next 3 days' — unsupported by the expander → filter
    // dropped to empty → must be skipped, NOT swept against the whole VIP base.
    expect(byId['19'].skipped).toBe('no-predicate');
    expect(byId['19'].opened).toBe(0);
    expect(fetched).not.toContain('19');

    // 01 First deposit ('last 3 months') compiles to a real window, so it is swept.
    expect(byId['01'].skipped).toBeUndefined();
    expect(byId['01'].opened).toBe(2);
    expect(fetched).toContain('01');

    // 18 Anniversary now compiles to an OR of milestone-day ranges (a real cohort
    // filter) instead of being dropped, so it is swept normally.
    expect(byId['18'].skipped).toBeUndefined();
    expect(fetched).toContain('18');
  });

  it('re-sweep of a stable cohort opens nothing new (idempotent)', async () => {
    const deps: SweepDeps = { fetchCohortUids: async () => ['u1', 'u2'] };
    await runCaseSweep('jus_vn', 'local', JUS_MEMBERS, deps);
    const second = await runCaseSweep('jus_vn', 'local', JUS_MEMBERS, deps);
    const p02 = second.find((s) => s.playbookId === '02')!;
    expect(p02.opened).toBe(0); // set-diff: stable cohort opens nothing new
    expect(listCases({ gameId: 'jus_vn', playbookId: '02' })).toHaveLength(2); // no dup rows
  });

  it('onlyPlaybookId scopes the sweep to a single playbook (per-segment manual sweep)', async () => {
    const deps: SweepDeps = { fetchCohortUids: async () => ['u1', 'u2'] };
    const summaries = await runCaseSweep('jus_vn', 'local', JUS_MEMBERS, deps, {}, '02');

    // Only the targeted playbook is in the summaries — every other one is absent.
    expect(summaries.map((s) => s.playbookId)).toEqual(['02']);
    expect(summaries[0].opened).toBe(2);

    // Only that playbook's cases were opened; a sibling membership playbook (14)
    // that a full sweep would have opened stays untouched.
    expect(listCases({ gameId: 'jus_vn', playbookId: '02' })).toHaveLength(2);
    expect(listCases({ gameId: 'jus_vn', playbookId: '14' })).toHaveLength(0);
  });
});
