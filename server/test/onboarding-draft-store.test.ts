/**
 * Integration tests for the onboarding draft store: upsert idempotence,
 * status-preservation across regeneration, status transitions, and the
 * append-only audit trail. Uses a temp DB file (migration 023 applies on open).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'onboarding-store-test-'));
process.env.DB_PATH = join(tmp, 'onboarding.db');

import { getDb, closeDb } from '../src/db/sqlite.js';
import {
  upsertDraft,
  listDrafts,
  getDraft,
  setDraftStatus,
  listDraftAudit,
  type UpsertDraftInput,
} from '../src/services/onboarding-draft-store.js';
import type { CubeModel } from '../src/types/cube-model.js';

const model: CubeModel = {
  cubes: [{ name: 'active_daily', sql_table: 'ballistar_vn.active_daily', dimensions: [], measures: [{ name: 'count', type: 'count' }] }],
};

function input(overrides: Partial<UpsertDraftInput> = {}): UpsertDraftInput {
  return {
    game: 'ballistar',
    connectorId: 'game_integration',
    schemaName: 'ballistar_vn',
    cubeName: 'active_daily',
    model,
    yaml: 'cubes:\n  - name: active_daily\n',
    source: 'cold',
    createdBy: 'alice@vng',
    ...overrides,
  };
}

beforeEach(() => {
  getDb().exec('DELETE FROM onboarding_draft_audit; DELETE FROM onboarding_draft_models;');
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('migration 023', () => {
  it('creates the draft + audit tables and advances user_version', () => {
    const v = getDb().pragma('user_version', { simple: true }) as number;
    expect(v).toBeGreaterThanOrEqual(23);
  });
});

describe('upsertDraft', () => {
  it('inserts a pending draft + a generate audit row', () => {
    const d = upsertDraft(input(), '2026-05-30T00:00:00Z');
    expect(d.status).toBe('pending');
    expect(d.createdBy).toBe('alice@vng');
    const audit = listDraftAudit(d.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('generate');
  });

  it('upserts on (game, cube_name) without duplicating rows', () => {
    upsertDraft(input(), '2026-05-30T00:00:00Z');
    upsertDraft(input({ yaml: 'changed' }), '2026-05-30T00:01:00Z');
    const all = listDrafts({ game: 'ballistar' });
    expect(all).toHaveLength(1);
    expect(all[0].yaml).toBe('changed');
  });

  it('preserves an accepted status across regeneration', () => {
    const d = upsertDraft(input(), '2026-05-30T00:00:00Z');
    setDraftStatus(d.id, 'accepted', 'alice@vng', { ts: '2026-05-30T00:01:00Z' });
    upsertDraft(input({ yaml: 'regenerated' }), '2026-05-30T00:02:00Z');
    expect(getDraft(d.id)?.status).toBe('accepted');
    expect(getDraft(d.id)?.yaml).toBe('regenerated');
  });

  it('preserves a written status across regeneration', () => {
    const d = upsertDraft(input(), '2026-05-30T00:00:00Z');
    setDraftStatus(d.id, 'written', 'bob@vng', { ts: '2026-05-30T00:01:00Z', approvedBy: 'bob@vng' });
    upsertDraft(input({ yaml: 'regenerated' }), '2026-05-30T00:02:00Z');
    expect(getDraft(d.id)?.status).toBe('written');
  });
});

describe('setDraftStatus + audit', () => {
  it('records every transition in the append-only audit', () => {
    const d = upsertDraft(input(), '2026-05-30T00:00:00Z');
    setDraftStatus(d.id, 'accepted', 'alice@vng', { ts: '2026-05-30T00:01:00Z' });
    setDraftStatus(d.id, 'written', 'bob@vng', { ts: '2026-05-30T00:02:00Z', approvedBy: 'bob@vng' });
    const audit = listDraftAudit(d.id);
    // generate + accept + write
    expect(audit.map((a) => a.action).sort()).toEqual(['accept', 'generate', 'write']);
  });

  it('records approved_by only on the written transition', () => {
    const d = upsertDraft(input(), '2026-05-30T00:00:00Z');
    setDraftStatus(d.id, 'accepted', 'alice@vng', { ts: '2026-05-30T00:01:00Z' });
    expect(getDraft(d.id)?.approvedBy).toBeNull();
    setDraftStatus(d.id, 'written', 'bob@vng', { ts: '2026-05-30T00:02:00Z', approvedBy: 'bob@vng' });
    expect(getDraft(d.id)?.approvedBy).toBe('bob@vng');
  });

  it('returns null for an unknown draft id', () => {
    expect(setDraftStatus(99999, 'accepted', 'x')).toBeNull();
  });
});

describe('listDrafts filtering', () => {
  it('filters by game and status', () => {
    const d1 = upsertDraft(input({ cubeName: 'a' }), '2026-05-30T00:00:00Z');
    upsertDraft(input({ cubeName: 'b' }), '2026-05-30T00:00:01Z');
    setDraftStatus(d1.id, 'accepted', 'alice@vng', { ts: '2026-05-30T00:01:00Z' });
    expect(listDrafts({ game: 'ballistar', status: 'pending' })).toHaveLength(1);
    expect(listDrafts({ game: 'ballistar', status: 'accepted' })).toHaveLength(1);
    expect(listDrafts({ game: 'other' })).toHaveLength(0);
  });
});
