/**
 * Unit tests for the chat-search bucket helper + long-form time-ago.
 * Pure functions, deterministic given `now`.
 */
import { describe, it, expect } from 'vitest';
import {
  bucketFor,
  groupSessions,
  formatTimeAgoLong,
} from '../group-sessions';
import type { SessionSummary } from '../../../pages/Chat/hooks/use-chat-sessions-list';

// Use local-time constructors so calendar boundaries stay unambiguous
// across timezones (bucketFor() uses local midnight).
const NOW = new Date(2026, 4, 24, 12, 0, 0).getTime(); // 2026-05-24 12:00 local
const isoLocal = (y: number, m: number, d: number, h = 12): string =>
  new Date(y, m, d, h, 0, 0).toISOString();

function makeSession(id: string, updatedAt: string, title = id): SessionSummary {
  return {
    id, title,
    gameId: 'ptg',
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('bucketFor', () => {
  it('classifies today', () => {
    expect(bucketFor(new Date(2026, 4, 24, 6).getTime(), NOW)).toBe('today');
  });

  it('classifies yesterday', () => {
    expect(bucketFor(new Date(2026, 4, 23, 18).getTime(), NOW)).toBe('yesterday');
  });

  it('classifies last 7 days', () => {
    expect(bucketFor(new Date(2026, 4, 20, 10).getTime(), NOW)).toBe('last7');
  });

  it('classifies last 30 days', () => {
    expect(bucketFor(new Date(2026, 4, 1, 10).getTime(), NOW)).toBe('last30');
  });

  it('classifies older', () => {
    expect(bucketFor(new Date(2025, 11, 25, 10).getTime(), NOW)).toBe('older');
  });
});

describe('groupSessions', () => {
  it('drops empty buckets and preserves input order within each bucket', () => {
    const sessions: SessionSummary[] = [
      makeSession('a', isoLocal(2026, 4, 24, 6)),   // today
      makeSession('b', isoLocal(2026, 4, 23, 18)),  // yesterday
      makeSession('c', isoLocal(2026, 4, 22, 10)),  // last7
      makeSession('d', isoLocal(2026, 4, 20, 10)),  // last7
      makeSession('e', isoLocal(2025, 11, 1, 10)),  // older
    ];
    const groups = groupSessions(sessions, NOW);
    expect(groups.map((g) => g.key)).toEqual(['today', 'yesterday', 'last7', 'older']);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['a']);
    expect(groups[1].sessions.map((s) => s.id)).toEqual(['b']);
    expect(groups[2].sessions.map((s) => s.id)).toEqual(['c', 'd']);
    expect(groups[3].sessions.map((s) => s.id)).toEqual(['e']);
  });

  it('skips sessions with invalid timestamps', () => {
    const sessions: SessionSummary[] = [
      makeSession('a', isoLocal(2026, 4, 24, 6)),
      makeSession('bad', 'not-a-date'),
    ];
    const groups = groupSessions(sessions, NOW);
    expect(groups.flatMap((g) => g.sessions).map((s) => s.id)).toEqual(['a']);
  });
});

describe('formatTimeAgoLong', () => {
  // Each ts derived from NOW via offset so it's TZ-independent.
  const fromOffset = (ms: number) => new Date(NOW - ms).toISOString();
  const m = 60_000;
  const h = 60 * m;
  const day = 24 * h;

  it.each<[string, string]>([
    [fromOffset(30 * 1000), 'just now'],
    [fromOffset(1 * h),     '1 hour ago'],
    [fromOffset(11 * h),    '11 hours ago'],
    [fromOffset(1 * day),   '1 day ago'],
    [fromOffset(2 * day),   '2 days ago'],
    [fromOffset(8 * day),   '1 week ago'],
    [fromOffset(40 * day),  '1 month ago'],
    [fromOffset(400 * day), '1 year ago'],
  ])('%s → %s', (iso, expected) => {
    expect(formatTimeAgoLong(iso, NOW)).toBe(expected);
  });

  it('returns empty string on bad input', () => {
    expect(formatTimeAgoLong(undefined, NOW)).toBe('');
    expect(formatTimeAgoLong('not-a-date', NOW)).toBe('');
  });
});
