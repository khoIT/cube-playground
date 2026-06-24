/**
 * lifecycle-tracking-segment — ensureLifecycleTrackingSegments() unit tests.
 *
 * Verifies the hidden all-users tracking segments are created with the exact
 * shape the snapshot job + membership writer require (predicate / mf_users /
 * empty-filter query / daily cadence / system owner), are idempotent across
 * repeated calls, and only cover lakehouse-mapped games.
 *
 * Uses a throwaway DB_PATH so the real segments.db is never touched.
 */
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'lifecycle-tracking-test-'));
process.env.DB_PATH = join(tmp, 'tracking.db');

import { getDb, closeDb } from '../src/db/sqlite.js';
import { lakehouseSchemaForGame } from '../src/lakehouse/lakehouse-trino-connector.js';
import {
  ensureLifecycleTrackingSegments,
  lifecycleTrackingSegmentId,
  isLifecycleTrackingSegmentId,
  LIFECYCLE_TRACKING_OWNER,
} from '../src/services/lifecycle-tracking-segment.js';

beforeEach(() => {
  getDb().exec("DELETE FROM segments WHERE owner = 'system:lifecycle-tracking'");
});

afterAll(() => closeDb());

describe('ensureLifecycleTrackingSegments', () => {
  it('creates hidden all-users segments with the snapshot-ready shape', () => {
    const res = ensureLifecycleTrackingSegments();
    expect(res.created.length).toBeGreaterThan(0);

    const id = res.created[0];
    expect(isLifecycleTrackingSegmentId(id)).toBe(true);

    const row = getDb().prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row.type).toBe('predicate');
    expect(row.cube).toBe('mf_users');
    expect(row.cube_query_json).toBe('{"filters":[]}');
    expect(row.owner).toBe(LIFECYCLE_TRACKING_OWNER);
    expect(row.visibility).toBe('personal');
    // Column default applies (not set explicitly in the insert).
    expect(row.snapshot_cadence).toBe('daily');
  });

  it('only covers lakehouse-mapped games', () => {
    const res = ensureLifecycleTrackingSegments();
    for (const id of [...res.created, ...res.existing]) {
      const game = id.replace('sys-lifecycle-all-users-', '');
      expect(lakehouseSchemaForGame(game)).not.toBeNull();
    }
  });

  it('is idempotent — a second run creates nothing', () => {
    const first = ensureLifecycleTrackingSegments();
    expect(first.created.length).toBeGreaterThan(0);

    const second = ensureLifecycleTrackingSegments();
    expect(second.created).toHaveLength(0);
    for (const id of first.created) {
      expect(second.existing).toContain(id);
    }
  });

  it('id helper round-trips', () => {
    expect(lifecycleTrackingSegmentId('cfm_vn')).toBe('sys-lifecycle-all-users-cfm_vn');
    expect(isLifecycleTrackingSegmentId('sys-lifecycle-all-users-cfm_vn')).toBe(true);
    expect(isLifecycleTrackingSegmentId('some-user-segment')).toBe(false);
  });
});
