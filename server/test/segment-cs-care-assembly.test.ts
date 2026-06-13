/**
 * CS-care payload assembly — member name/ltv resolution from the profile
 * snapshot, risk-scored watchlist ordering, and median anchor selection.
 * Pure functions, no Trino.
 */

import { describe, expect, it } from 'vitest';
import {
  resolveMemberInfo,
  buildWatchlist,
  riskScore,
  medianDate,
} from '../src/routes/segment-cs-care-assembly.js';
import type { CsTicketRow } from '../src/lakehouse/cs-ticket-reader.js';
import type { MemberProfiles } from '../src/types/segment.js';

function ticket(over: Partial<CsTicketRow> = {}): CsTicketRow {
  return {
    uid: 'u1', ticketId: 't1', logDate: '2026-05-01', source: 'Web',
    labelCategory: 'Payment', labelName: 'x', sentiment: 'Neutral',
    rating: 5, statusGroup: 'Closed', ...over,
  };
}

const profiles: MemberProfiles = {
  computed_at: '2026-06-01',
  rank_measure: 'mf_users.ltv_total_vnd',
  columns: [
    { key: 'name', label: 'In-game name', field: 'mf_users.ingame_name' },
    { key: 'ltv', label: 'LTV', field: 'mf_users.ltv_total_vnd', format: 'currency' },
  ],
  rows: [
    { uid: 'a', name: 'Alice', ltv: 9_000_000 },
    { uid: 'b', name: 'Bob', ltv: 1_000_000 },
    { uid: 'c', name: null, ltv: null },
  ],
};

describe('resolveMemberInfo', () => {
  it('resolves name + ltv by heuristic column keys', () => {
    const m = resolveMemberInfo(profiles);
    expect(m.get('a')).toEqual({ name: 'Alice', ltv: 9_000_000 });
    expect(m.get('c')).toEqual({ name: null, ltv: null });
  });
  it('null / empty profiles → empty map', () => {
    expect(resolveMemberInfo(null).size).toBe(0);
    expect(resolveMemberInfo({ ...profiles, rows: [] }).size).toBe(0);
  });
});

describe('riskScore', () => {
  it('escalates with negative sentiment, low rating, open status, high-stakes category', () => {
    const hot = riskScore(ticket({ sentiment: 'Negative', rating: 1, statusGroup: 'New', labelCategory: 'Payment' }), 1);
    const cold = riskScore(ticket({ sentiment: 'Positive', rating: 5, statusGroup: 'Closed', labelCategory: 'General' }), 0);
    expect(hot).toBeGreaterThan(cold);
    expect(hot).toBe(40 + 25 + 20 + 10 + 15); // all weights + full ltv-rank
    expect(cold).toBe(0);
  });
});

describe('buildWatchlist', () => {
  it('orders by risk desc, enriches with member info, and reports days-since', () => {
    const memberInfo = resolveMemberInfo(profiles);
    const rows: CsTicketRow[] = [
      ticket({ uid: 'a', logDate: '2026-06-10', sentiment: 'Negative', rating: 1, statusGroup: 'New', labelCategory: 'Payment' }),
      ticket({ uid: 'b', logDate: '2026-06-01', sentiment: 'Positive', rating: 5, statusGroup: 'Closed', labelCategory: 'General' }),
    ];
    const wl = buildWatchlist(rows, memberInfo, '2026-06-13');
    expect(wl[0].uid).toBe('a'); // highest risk first
    expect(wl[0].name).toBe('Alice');
    expect(wl[0].daysSince).toBe(3);
    expect(wl[0].riskScore).toBeGreaterThan(wl[1].riskScore);
  });

  it('uses the latest ticket per member for the row', () => {
    const rows: CsTicketRow[] = [
      ticket({ uid: 'a', logDate: '2026-01-01', statusGroup: 'Closed', labelCategory: 'Account' }),
      ticket({ uid: 'a', logDate: '2026-06-10', statusGroup: 'New', labelCategory: 'Payment' }),
    ];
    const wl = buildWatchlist(rows, new Map(), '2026-06-13');
    expect(wl).toHaveLength(1);
    expect(wl[0].lastCategory).toBe('Payment'); // latest ticket wins
    expect(wl[0].statusGroup).toBe('New');
  });
});

describe('medianDate', () => {
  it('returns the lower-median for even counts and null for empty', () => {
    expect(medianDate(['2026-01-10', '2026-01-01', '2026-01-20', '2026-01-05'])).toBe('2026-01-05');
    expect(medianDate(['2026-03-03'])).toBe('2026-03-03');
    expect(medianDate([])).toBeNull();
  });
});
