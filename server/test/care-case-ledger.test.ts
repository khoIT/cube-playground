/**
 * Phase-1 ledger + engine: idempotent open against the unique partial index,
 * membership enter/exit (condition_lapsed), trigger opens, snapshot persistence,
 * by-vip grouping, and treatment patching lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, closeDb } from '../src/db/sqlite.js';
import {
  openCase,
  listCases,
  patchCase,
  findOpenCase,
  casesForUid,
} from '../src/care/care-case-store.js';
import {
  membershipDiff,
  applyMembershipResult,
  applyTriggerResult,
  groupCasesByVip,
  openUidsForPlaybook,
} from '../src/care/care-case-engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

const ctx = (playbookId: string) => ({ gameId: 'jus_vn', workspace: 'local', playbookId });

beforeEach(() => setDb(makeMemDb()));
afterEach(() => closeDb());

describe('membershipDiff', () => {
  it('computes entered/exited as set differences', () => {
    expect(membershipDiff(['a', 'b'], ['b', 'c'])).toEqual({ entered: ['c'], exited: ['a'] });
  });
});

describe('openCase idempotency', () => {
  it('a second open while still open is a no-op (one row)', () => {
    const first = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '14', uid: 'u1', source: 'membership' });
    const second = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '14', uid: 'u1', source: 'membership' });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.case.id).toBe(first.case.id);
    expect(listCases({ gameId: 'jus_vn', playbookId: '14' })).toHaveLength(1);
  });

  it('resolving frees the slot so a later re-trigger opens a fresh occurrence', () => {
    const first = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '14', uid: 'u1', source: 'membership' });
    patchCase(first.case.id, { status: 'resolved' });
    const again = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '14', uid: 'u1', source: 'membership' });
    expect(again.created).toBe(true);
    expect(again.case.id).not.toBe(first.case.id);
    expect(listCases({ gameId: 'jus_vn', playbookId: '14' })).toHaveLength(2);
  });

  it('persists the stats snapshot at open time', () => {
    const { case: c } = openCase({
      gameId: 'jus_vn', workspace: 'local', playbookId: '04', uid: 'u9', source: 'trigger',
      statsSnapshot: { ratio_7d_30d: 0.21 },
    });
    expect(JSON.parse(c.stats_snapshot_json!)).toEqual({ ratio_7d_30d: 0.21 });
  });
});

describe('applyMembershipResult', () => {
  it('opens entered, no dup on re-sweep of a stable cohort', () => {
    const r1 = applyMembershipResult(['a', 'b', 'c'], ctx('14'));
    expect(r1.opened).toBe(3);
    // Stable cohort: set-diff yields no `entered`, so nothing is re-opened.
    const r2 = applyMembershipResult(['a', 'b', 'c'], ctx('14'));
    expect(r2.opened).toBe(0);
    expect(r2.lapsed).toBe(0);
    expect(openUidsForPlaybook('jus_vn', '14').sort()).toEqual(['a', 'b', 'c']);
    expect(listCases({ gameId: 'jus_vn', playbookId: '14' })).toHaveLength(3); // no dup rows
  });

  it('flags condition_lapsed (keeps open) for users who exit before treatment', () => {
    applyMembershipResult(['a', 'b'], ctx('14'));
    const r = applyMembershipResult(['a'], ctx('14')); // b exited
    expect(r.lapsed).toBe(1);
    const bCase = findOpenCase('jus_vn', '14', 'b')!;
    expect(bCase.condition_lapsed).toBe(1);
    expect(bCase.status).not.toBe('dismissed'); // kept open, just flagged
  });

  it('does NOT flag a treated case that exits (that is a success, not a lapse)', () => {
    applyMembershipResult(['a'], ctx('14'));
    const aCase = findOpenCase('jus_vn', '14', 'a')!;
    patchCase(aCase.id, { status: 'treated' });
    const r = applyMembershipResult([], ctx('14')); // a exited after treatment
    expect(r.lapsed).toBe(0);
    expect(findOpenCase('jus_vn', '14', 'a')!.condition_lapsed).toBe(0);
  });
});

describe('applyTriggerResult', () => {
  it('opens one case per matched user with source trigger', () => {
    const r = applyTriggerResult(['x', 'y'], ctx('03'));
    expect(r.opened).toBe(2);
    expect(listCases({ gameId: 'jus_vn', playbookId: '03' }).every((c) => c.source === 'trigger')).toBe(true);
  });
});

describe('by-vip grouping & treatment lifecycle', () => {
  it('a VIP in 2 playbooks appears once with both case ids', () => {
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '14', uid: 'whale', source: 'membership' });
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '04', uid: 'whale', source: 'trigger' });
    openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '14', uid: 'other', source: 'membership' });

    const groups = groupCasesByVip(listCases({ gameId: 'jus_vn' }));
    const whale = groups.find((g) => g.uid === 'whale')!;
    expect(whale.caseCount).toBe(2);
    expect(whale.playbookIds.sort()).toEqual(['04', '14']);
  });

  it('treating a case stamps treated_at and surfaces in cross-playbook history', () => {
    const { case: c } = openCase({ gameId: 'jus_vn', workspace: 'local', playbookId: '02', uid: 'vip1', source: 'membership' });
    const treated = patchCase(c.id, { status: 'treated', channelUsed: 'call', actionTaken: 'tier benefits' })!;
    expect(treated.status).toBe('treated');
    expect(treated.treated_at).not.toBeNull();
    const history = casesForUid('jus_vn', 'vip1');
    expect(history).toHaveLength(1);
    expect(history[0].channel_used).toBe('call');
  });
});
