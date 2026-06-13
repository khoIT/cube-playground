/**
 * CareTab render branches — ready (pulse + watchlist + mix + impact), degraded
 * (csImpact null → impact strip hidden, rest renders), no-coverage (NO_CS_CARE
 * 404 → notice, not an error), and error. The endpoint itself is covered by the
 * server route tests; here fetchSegmentCsCare is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Segment } from '../../../../../types/segment-api';
import type { CsCarePayload } from '../../../../../api/segment-cs-care';
import { SegmentApiError } from '../../../../../api/api-client';

const fetchMock = vi.fn();
vi.mock('../../../../../api/segment-cs-care', async (orig) => ({
  ...(await orig<typeof import('../../../../../api/segment-cs-care')>()),
  fetchSegmentCsCare: (...args: unknown[]) => fetchMock(...args),
}));

import { CareTab } from '../care-tab';

function payload(over: Partial<CsCarePayload> = {}): CsCarePayload {
  return {
    segmentId: 's1',
    gameId: 'jus_vn',
    productId: 832,
    coverage: { totalMembers: 276, contactedMembers: 22, pct: 8.0, truncated: false },
    freshness: { csMaxLogDate: '2026-06-13' },
    pulse: { tickets: 29, contacted: 22, openUnresolved: 7, negativeSentiment: 3, lowRating: 2 },
    issueMix: [
      { category: 'Payment', tickets: 11, members: 9 },
      { category: 'Account', tickets: 8, members: 7 },
    ],
    watchlist: [
      { uid: '111', name: 'Whale_A', ltv: 184_200_000, lastCategory: 'Payment', lastSource: 'Web', sentiment: 'Negative', rating: 1, statusGroup: 'New', daysSince: 4, riskScore: 95 },
      { uid: '222', name: null, ltv: null, lastCategory: 'Account', lastSource: 'Ingame', sentiment: 'Positive', rating: 5, statusGroup: 'Closed', daysSince: 30, riskScore: 18 },
    ],
    csImpact: {
      contacted: { n: 22, avgRevPre: 100, avgRevPost: 69, deltaPct: -31 },
      nonContacted: { n: 200, avgRevPre: 100, avgRevPost: 94, deltaPct: -6 },
      windowDays: 30,
      smallSample: true,
    },
    ...over,
  };
}

const seg = (over: Partial<Segment> = {}): Segment =>
  ({ id: 's1', type: 'predicate', game_id: 'jus_vn', name: 'whales', ...over } as unknown as Segment);

const renderTab = (s = seg()) =>
  render(
    <MemoryRouter>
      <CareTab segment={s} />
    </MemoryRouter>,
  );

beforeEach(() => {
  fetchMock.mockReset();
});

describe('CareTab', () => {
  it('renders pulse + watchlist + issue mix + impact on a ready payload', async () => {
    fetchMock.mockResolvedValue(payload());
    renderTab();
    await waitFor(() => expect(screen.getByText('Whale_A')).toBeTruthy());
    // coverage strip
    expect(screen.getByText(/8\.0%/)).toBeTruthy();
    // issue mix categories (also appears as a watchlist row's last issue)
    expect(screen.getAllByText('Payment').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Account').length).toBeGreaterThan(0);
    // impact delta + small-sample caption
    expect(screen.getByText('−31%')).toBeTruthy();
    expect(screen.getByText(/Directional, small sample/i)).toBeTruthy();
    // watchlist drills to member-360
    expect(screen.getByText('Whale_A').closest('a')?.getAttribute('href')).toContain('/segments/s1/members/111');
  });

  it('hides the impact strip when csImpact is null (degraded), watchlist still renders', async () => {
    fetchMock.mockResolvedValue(payload({ csImpact: null }));
    renderTab();
    await waitFor(() => expect(screen.getByText('Whale_A')).toBeTruthy());
    expect(screen.queryByText(/Directional/i)).toBeNull();
  });

  it('shows a no-coverage notice on NO_CS_CARE 404 (not an error)', async () => {
    fetchMock.mockRejectedValue(new SegmentApiError('NO_CS_CARE', 'no', 404));
    renderTab();
    await waitFor(() => expect(screen.getByText(/CS history overlay is available/i)).toBeTruthy());
  });

  it('shows the error state on an unexpected failure', async () => {
    fetchMock.mockRejectedValue(new SegmentApiError('CS_CARE_UNAVAILABLE', 'trino down', 502));
    renderTab();
    await waitFor(() => expect(screen.getByText('trino down')).toBeTruthy());
  });
});
