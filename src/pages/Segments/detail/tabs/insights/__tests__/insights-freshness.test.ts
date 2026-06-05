import { describe, it, expect } from 'vitest';
import { summariseCardFreshness } from '../insights-freshness';
import type { Segment } from '../../../../../../types/segment-api';

type Cache = NonNullable<Segment['card_cache']>;

describe('summariseCardFreshness', () => {
  it('returns no newest + zero errors when there is no cache', () => {
    expect(summariseCardFreshness(undefined)).toEqual({ newest: null, errorCount: 0 });
    expect(summariseCardFreshness({})).toEqual({ newest: null, errorCount: 0 });
  });

  it('picks the most recent fetched_at across cards', () => {
    const cache: Cache = {
      a: { rows: [], fetched_at: '2026-06-05T01:00:00Z', status: 'ok' },
      b: { rows: [], fetched_at: '2026-06-05T03:00:00Z', status: 'ok' },
      c: { rows: [], fetched_at: '2026-06-05T02:00:00Z', status: 'ok' },
    };
    expect(summariseCardFreshness(cache).newest).toBe('2026-06-05T03:00:00Z');
  });

  it('counts cards with status=error and tolerates missing status (legacy ok)', () => {
    const cache: Cache = {
      a: { rows: [], fetched_at: '2026-06-05T01:00:00Z', status: 'error', error: 'boom' },
      b: { rows: [], fetched_at: '2026-06-05T02:00:00Z', status: 'error' },
      c: { rows: [], fetched_at: '2026-06-05T03:00:00Z' }, // legacy row, no status
    };
    const out = summariseCardFreshness(cache);
    expect(out.errorCount).toBe(2);
    expect(out.newest).toBe('2026-06-05T03:00:00Z');
  });

  it('ignores unparseable timestamps when choosing newest', () => {
    const cache: Cache = {
      a: { rows: [], fetched_at: 'not-a-date', status: 'ok' },
      b: { rows: [], fetched_at: '2026-06-05T05:00:00Z', status: 'ok' },
    };
    expect(summariseCardFreshness(cache).newest).toBe('2026-06-05T05:00:00Z');
  });
});
