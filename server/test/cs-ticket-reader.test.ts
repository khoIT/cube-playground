/**
 * CS ticket reader + recharge trajectory — SQL shape (uid escaping, product
 * filter, per-ticket dedup CTEs, empty short-circuit, window math) and the pure
 * rollups (pulse / issue-mix / cohort recharge). Trino mocked, plus the
 * product-map coverage gate.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const runQueryMock = vi.fn();
vi.mock('../src/services/trino-rest-client.js', () => ({
  runQuery: (...args: unknown[]) => runQueryMock(...args),
}));

import {
  fetchCsTickets,
  summarizeCsTickets,
  type CsTicketRow,
} from '../src/lakehouse/cs-ticket-reader.js';
import {
  readRechargeAroundAnchors,
  summarizeCohortRecharge,
} from '../src/lakehouse/cs-recharge-trajectory.js';
import { csProductId, hasCsCoverage, csCoverageGames } from '../src/lakehouse/cs-product-map.js';
import type { Connector } from '../src/services/trino-profiler-config.js';

const connector: Connector = {
  id: 'test', label: 'test', workspaceId: 'local', sourceType: 'trino',
  host: 'unused', port: 8080, user: 'test', password: '', catalog: 'game_integration', ssl: false,
};

beforeEach(() => {
  runQueryMock.mockReset();
  runQueryMock.mockResolvedValue({ columns: [], rows: [] });
});

function row(over: Partial<CsTicketRow> = {}): CsTicketRow {
  return {
    uid: 'u1', ticketId: 't1', logDate: '2026-02-05', source: 'Web',
    labelCategory: 'Payment', labelName: 'Payment_X', sentiment: 'Neutral',
    rating: 5, statusGroup: 'Closed', ...over,
  };
}

describe('cs-product-map', () => {
  it('maps coverage games to product ids and gates the rest', () => {
    expect(csProductId('jus_vn')).toBe(832);
    expect(csProductId('jus')).toBe(832); // canonical alias
    expect(csProductId('cfm_vn')).toBe(856);
    expect(csProductId('ballistar')).toBeNull();
    expect(hasCsCoverage('jus_vn')).toBe(true);
    expect(hasCsCoverage('ballistar')).toBe(false);
    expect(csCoverageGames()).toEqual(expect.arrayContaining(['jus', 'cfm']));
  });
});

describe('fetchCsTickets — SQL shape', () => {
  it('short-circuits without hitting Trino on empty/garbage uids', async () => {
    expect(await fetchCsTickets({ productId: 832, uids: [], sinceDate: '2025-01-01', connector })).toEqual([]);
    expect(await fetchCsTickets({ productId: 832, uids: ["bad'; DROP", '!!'], sinceDate: '2025-01-01', connector })).toEqual([]);
    expect(runQueryMock).not.toHaveBeenCalled();
  });

  it('filters by product + date, inlines only sane uids, and dedupes ticket grain', async () => {
    await fetchCsTickets({ productId: 832, uids: ['123', '456', "drop'"], sinceDate: '2025-06-13', connector });
    const sql = runQueryMock.mock.calls[0][2] as string;
    expect(sql).toContain('product_id = 832');
    expect(sql).toContain("log_date >= DATE '2025-06-13'");
    expect(sql).toContain("IN ('123', '456')"); // garbage uid rejected, not escaped-in
    // Per-ticket dedup: master + label reduced to one row each before the join.
    expect(sql).toContain('row_number() OVER (PARTITION BY ticket_id');
    expect(sql).toContain('LEFT JOIN master m ON m.ticket_id = i.ticket_id AND m.rn = 1');
    expect(sql).toContain('cs_ticket_new_master');
    expect(sql).not.toContain('cs_ticket_master '); // the broken stale-pointer table
  });

  it('maps Trino rows into typed ticket rows (nulls preserved)', async () => {
    runQueryMock.mockResolvedValue({
      columns: [],
      rows: [['123', '999', '2026-02-05', 'Web', 'Payment', 'Payment_X', 'Negative', 1, 'Closed'],
             ['123', '998', '2025-11-29', 'Ingame', null, null, null, null, 'New']],
    });
    const out = await fetchCsTickets({ productId: 832, uids: ['123'], sinceDate: '2025-06-13', connector });
    expect(out[0]).toEqual({
      uid: '123', ticketId: '999', logDate: '2026-02-05', source: 'Web',
      labelCategory: 'Payment', labelName: 'Payment_X', sentiment: 'Negative', rating: 1, statusGroup: 'Closed',
    });
    expect(out[1].labelCategory).toBeNull();
    expect(out[1].rating).toBeNull();
  });
});

describe('summarizeCsTickets', () => {
  it('counts pulse + issue mix with distinct members, open ≠ closed/rejected', () => {
    const rows = [
      row({ uid: 'a', sentiment: 'Negative', rating: 1, statusGroup: 'New', labelCategory: 'Payment' }),
      row({ uid: 'a', sentiment: 'Positive', rating: 5, statusGroup: 'Closed', labelCategory: 'Account' }),
      row({ uid: 'b', sentiment: 'Neutral', rating: null, statusGroup: 'Rejected', labelCategory: 'Payment' }),
      row({ uid: 'c', sentiment: 'Negative', rating: 2, statusGroup: 'Processing', labelCategory: null }),
    ];
    const { pulse, issueMix } = summarizeCsTickets(rows);
    expect(pulse.tickets).toBe(4);
    expect(pulse.contacted).toBe(3); // a, b, c
    expect(pulse.openUnresolved).toBe(2); // New + Processing (Closed/Rejected excluded)
    expect(pulse.negativeSentiment).toBe(2);
    expect(pulse.lowRating).toBe(2); // rating 1 and 2
    // Payment leads (2 tickets, 2 members); null category → 'Uncategorized'.
    expect(issueMix[0]).toEqual({ category: 'Payment', tickets: 2, members: 2 });
    expect(issueMix.some((m) => m.category === 'Uncategorized')).toBe(true);
  });

  it('empty rows → zeroed pulse, empty mix', () => {
    const { pulse, issueMix } = summarizeCsTickets([]);
    expect(pulse).toEqual({ tickets: 0, contacted: 0, openUnresolved: 0, negativeSentiment: 0, lowRating: 0 });
    expect(issueMix).toEqual([]);
  });
});

describe('readRechargeAroundAnchors — SQL shape + mapping', () => {
  it('short-circuits on empty/invalid anchors', async () => {
    expect(await readRechargeAroundAnchors({ gameId: 'jus_vn', anchors: [], connector })).toEqual([]);
    expect(await readRechargeAroundAnchors({ gameId: 'jus_vn', anchors: [{ uid: 'x', anchor: 'not-a-date' }], connector })).toEqual([]);
    expect(runQueryMock).not.toHaveBeenCalled();
  });

  it('builds a per-uid VALUES window query against the recharge table', async () => {
    runQueryMock.mockResolvedValue({ columns: [], rows: [['123', '1000', '2500']] });
    const out = await readRechargeAroundAnchors({
      gameId: 'jus_vn', anchors: [{ uid: '123', anchor: '2025-11-29' }], windowDays: 30, connector,
    });
    const sql = runQueryMock.mock.calls[0][2] as string;
    expect(sql).toContain('std_ingame_user_recharge_daily');
    expect(sql).toContain("VALUES ('123', DATE '2025-11-29')");
    expect(sql).toContain("split_part(r.user_id, '@', 1) = a.uid");
    expect(sql).toContain("date_add('day', -30, a.anchor)");
    expect(out).toEqual([{ uid: '123', pre: 1000, post: 2500 }]);
  });
});

describe('summarizeCohortRecharge', () => {
  it('averages pre/post and computes a directional delta %', () => {
    const s = summarizeCohortRecharge([{ uid: 'a', pre: 100, post: 150 }, { uid: 'b', pre: 100, post: 50 }]);
    expect(s.n).toBe(2);
    expect(s.avgRevPre).toBe(100);
    expect(s.avgRevPost).toBe(100);
    expect(s.deltaPct).toBe(0);
  });
  it('null delta when pre-window spend is zero (no divide-by-zero)', () => {
    const s = summarizeCohortRecharge([{ uid: 'a', pre: 0, post: 500 }]);
    expect(s.deltaPct).toBeNull();
  });
  it('empty cohort → zeros + null delta', () => {
    expect(summarizeCohortRecharge([])).toEqual({ n: 0, avgRevPre: 0, avgRevPost: 0, deltaPct: null });
  });
});
