/**
 * Paginated reader: daily keyset pinning, NULL-ts tolerance, no-snapshot error,
 * manual in-memory paging, and token/segment binding.
 *
 * The Trino read is injected as a mock `query` that interprets the reader's SQL
 * against an in-memory uid set — no warehouse, no HTTP.
 */

import { describe, it, expect } from 'vitest';
import {
  readPage,
  NoSnapshotError,
  InvalidPageTokenError,
  type PageSegment,
  type RowQueryFn,
} from '../src/services/segment-page-reader.js';
import { encodePageToken } from '../src/services/segment-page-token.js';

/** uid-0001 … uid-NNNN, sorted ascending (matches Iceberg sorted_by uid). */
function makeUids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `uid-${String(i + 1).padStart(4, '0')}`);
}

/** A mock query fn answering the three SQL shapes the daily reader emits. */
function makeDailyQuery(opts: {
  uids: string[];
  date?: string | null;
  ts?: string | null;
}): RowQueryFn {
  const { uids, date = '2026-06-25', ts = '2026-06-25 08:00:00.000' } = opts;
  return async (sql: string) => {
    if (sql.includes('max(snapshot_date)')) return [[date]];
    if (sql.includes('max(snapshot_ts)')) return [[ts]];
    // page query: SELECT uid ... [AND uid > 'X'] ORDER BY uid ASC LIMIT N
    const limit = Number(/LIMIT (\d+)/.exec(sql)?.[1] ?? '0');
    const cursorMatch = /uid > '([^']*)'/.exec(sql);
    const cursor = cursorMatch ? cursorMatch[1] : '';
    const start = cursor ? uids.findIndex((u) => u > cursor) : 0;
    const from = start === -1 ? uids.length : start;
    return uids.slice(from, from + limit).map((u) => [u]);
  };
}

const dailySeg: PageSegment = { id: 'seg-1', game_id: 'cfm_vn', type: 'predicate', uid_count: 2500 };

describe('segment-page-reader — daily', () => {
  it('page 1 pins the latest snapshot and returns the first <=limit uids ascending', async () => {
    const uids = makeUids(2500);
    const res = await readPage({ segment: dailySeg, limit: 1000 }, makeDailyQuery({ uids }));
    expect(res.uids).toHaveLength(1000);
    expect(res.uids[0]).toBe('uid-0001');
    expect(res.uids[999]).toBe('uid-1000');
    expect(res.has_more).toBe(true);
    expect(res.next_page_id).toBeTruthy();
    expect(res.total_count).toBe(2500);
  });

  it('walking next_page_id yields disjoint ordered slices to completion', async () => {
    const uids = makeUids(2500);
    const query = makeDailyQuery({ uids });
    const collected: string[] = [];
    let pageId: string | undefined;
    let guard = 0;
    for (;;) {
      const res = await readPage({ segment: dailySeg, limit: 1000, pageId }, query);
      collected.push(...res.uids);
      expect(res.total_count).toBe(2500); // constant across pages, never from token
      if (!res.next_page_id) {
        expect(res.has_more).toBe(false);
        break;
      }
      pageId = res.next_page_id;
      if (++guard > 10) throw new Error('pagination did not terminate');
    }
    expect(collected).toEqual(uids); // disjoint, ordered, complete
    expect(new Set(collected).size).toBe(2500);
  });

  it('pages a NULL snapshot_ts (legacy) partition without a false error', async () => {
    const uids = makeUids(50);
    const query = makeDailyQuery({ uids, ts: null });
    const res = await readPage({ segment: dailySeg, limit: 1000 }, query);
    expect(res.uids).toHaveLength(50);
    expect(res.has_more).toBe(false);
    expect(res.next_page_id).toBeNull();
  });

  it('emits a NULL-tolerant predicate when ts is null', async () => {
    let pageSql = '';
    const query: RowQueryFn = async (sql) => {
      if (sql.includes('max(snapshot_date)')) return [['2026-06-25']];
      if (sql.includes('max(snapshot_ts)')) return [[null]];
      pageSql = sql;
      return [];
    };
    await readPage({ segment: dailySeg, limit: 10 }, query);
    expect(pageSql).toContain('snapshot_ts IS NULL');
    expect(pageSql).not.toContain('= NULL');
  });

  it('throws NoSnapshotError when no partition exists', async () => {
    const query = makeDailyQuery({ uids: [], date: null });
    await expect(readPage({ segment: dailySeg }, query)).rejects.toBeInstanceOf(NoSnapshotError);
  });
});

describe('segment-page-reader — manual', () => {
  const uids = makeUids(2300);
  const manualSeg: PageSegment = {
    id: 'seg-m',
    game_id: 'cfm_vn',
    type: 'manual',
    uid_count: 2300,
    uid_list_json: JSON.stringify([...uids].reverse()), // unsorted on purpose
  };
  const noQuery: RowQueryFn = async () => {
    throw new Error('manual source must not hit the warehouse');
  };

  it('pages the uid_list in ascending order to completion without querying', async () => {
    const collected: string[] = [];
    let pageId: string | undefined;
    let guard = 0;
    for (;;) {
      const res = await readPage({ segment: manualSeg, limit: 1000, pageId }, noQuery);
      collected.push(...res.uids);
      expect(res.total_count).toBe(2300);
      if (!res.next_page_id) {
        expect(res.has_more).toBe(false);
        break;
      }
      pageId = res.next_page_id;
      if (++guard > 10) throw new Error('pagination did not terminate');
    }
    expect(collected).toEqual(uids);
  });

  it('handles an empty uid_list', async () => {
    const res = await readPage(
      { segment: { ...manualSeg, uid_list_json: '[]' } },
      noQuery,
    );
    expect(res.uids).toEqual([]);
    expect(res.has_more).toBe(false);
    expect(res.next_page_id).toBeNull();
  });
});

describe('segment-page-reader — token binding', () => {
  it('rejects a malformed page_id', async () => {
    await expect(
      readPage({ segment: dailySeg, pageId: 'garbage' }, makeDailyQuery({ uids: [] })),
    ).rejects.toBeInstanceOf(InvalidPageTokenError);
  });

  it('rejects a token minted for a different segment', async () => {
    const foreign = encodePageToken({
      v: 1,
      source: 'daily',
      segmentId: 'other-seg',
      snapshotDate: '2026-06-25',
      snapshotTs: null,
      lastUid: 'uid-0001',
    });
    await expect(
      readPage({ segment: dailySeg, pageId: foreign }, makeDailyQuery({ uids: [] })),
    ).rejects.toBeInstanceOf(InvalidPageTokenError);
  });
});
