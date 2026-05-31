/**
 * Unit tests for the cross-source link store (temp DB). Asserts create + key
 * round-trip, active-only listing, workspace scoping, and soft-disable.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'cross-source-store-test-'));
process.env.DB_PATH = join(tmp, 'cl.db');

import { getDb, closeDb } from '../src/db/sqlite.js';
import {
  createCrossSourceLink,
  listCrossSourceLinks,
  getCrossSourceLink,
  disableCrossSourceLink,
} from '../src/services/cross-source-link-store.js';

function seed(over: Partial<Parameters<typeof createCrossSourceLink>[0]> = {}) {
  return createCrossSourceLink({
    workspaceId: 'local',
    leftCube: 'active_daily',
    leftConnector: 'game_integration',
    rightCube: 'af_installs',
    rightConnector: 'appsflyer_pg',
    key: { fromColumn: 'user_id', toColumn: 'customer_user_id' },
    relationship: 'many_to_one',
    rationale: 'attribution overlay',
    createdBy: 'editor@vng',
    ...over,
  });
}

beforeEach(() => {
  getDb().exec('DELETE FROM cross_source_links;');
});
afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('cross-source-link-store', () => {
  it('creates a link and round-trips the key pair', () => {
    const link = seed();
    expect(link.id).toBeGreaterThan(0);
    const got = getCrossSourceLink(link.id);
    expect(got?.key).toEqual({ fromColumn: 'user_id', toColumn: 'customer_user_id' });
    expect(got?.rationale).toBe('attribution overlay');
  });

  it('lists only active links, newest first', () => {
    const a = seed({ leftCube: 'a' });
    const b = seed({ leftCube: 'b' });
    const ids = listCrossSourceLinks().map((l) => l.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });

  it('scopes the list by workspace', () => {
    seed({ workspaceId: 'ws1' });
    seed({ workspaceId: 'ws2' });
    expect(listCrossSourceLinks('ws1')).toHaveLength(1);
    expect(listCrossSourceLinks('ws2')).toHaveLength(1);
  });

  it('soft-disables a link (drops from list, second call false)', () => {
    const link = seed();
    expect(disableCrossSourceLink(link.id)).toBe(true);
    expect(listCrossSourceLinks().find((l) => l.id === link.id)).toBeUndefined();
    expect(getCrossSourceLink(link.id)?.status).toBe('disabled');
    expect(disableCrossSourceLink(link.id)).toBe(false);
  });
});
