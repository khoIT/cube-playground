/**
 * CareWatchlist row-expand — the member name links to the Member 360 page, the
 * summary cards' "View full care history" link goes to /care, and clicking a row
 * lazy-fetches that member's CS tickets and renders summary cards (labels +
 * snippet + reopen/security badges). fetchMemberCsTickets
 * is mocked; the endpoint is covered by server route tests.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CsCareWatchlistEntry } from '../../../../../api/segment-cs-care';
import type { CsTicketsPayload, CsTicketDetail } from '../../../../../api/segment-cs-care-member';

const fetchMock = vi.fn();
vi.mock('../../../../../api/segment-cs-care-member', async (orig) => ({
  ...(await orig<typeof import('../../../../../api/segment-cs-care-member')>()),
  fetchMemberCsTickets: (...args: unknown[]) => fetchMock(...args),
}));

import { CareWatchlist } from '../care/care-watchlist';

const entry: CsCareWatchlistEntry = {
  uid: '111',
  name: 'Whale_A',
  ltv: 184_200_000,
  lastCategory: 'Payment',
  lastSource: 'Web',
  sentiment: 'Negative',
  rating: 1,
  statusGroup: 'New',
  daysSince: 4,
  riskScore: 95,
};

function ticket(over: Partial<CsTicketDetail> = {}): CsTicketDetail {
  return {
    ticketId: 't1',
    uid: '111',
    source: 'Web',
    formName: 'Form',
    openedAt: '2026-02-05',
    status: 'Closed',
    priority: 5,
    staffDept: 'CTS',
    staffDomain: 'agent',
    latencyMin: 23,
    reopenCount: 2,
    sentiment: { first: 'Neutral', last: 'Negative', change: 'Change Status' },
    securityFlag: true,
    loginInfo: 'someone-else',
    tags: ['#NTH-Billing'],
    labels: [{ category: 'Payment', name: 'Payment_FailedTransaction' }],
    rating: { rating: 1, feedback: 'meh', feedbackOptions: [] },
    messages: [{ at: '2026-02-05 15:00:00', isCustomer: true, text: 'My top-up failed but money was deducted', attachments: [] }],
    messagesTruncated: false,
    vip: null,
    ...over,
  };
}

const payload = (tickets: CsTicketDetail[]): CsTicketsPayload => ({
  segmentId: 's1',
  gameId: 'jus_vn',
  productId: 832,
  uid: '111',
  member: { name: 'Whale_A', ltv: 184_200_000 },
  coverage: { joined: tickets.length > 0, note: null },
  freshness: { csMaxLogDate: '2026-02-05' },
  recharge: null,
  tickets,
});

const renderList = () =>
  render(
    <MemoryRouter>
      <CareWatchlist segmentId="s1" rows={[entry]} />
    </MemoryRouter>,
  );

// No beforeEach mock-reset: a mock-touching beforeEach hook makes vitest's
// rejected-promise tracking spuriously report the error-state test's (handled)
// rejection as unhandled. Each test sets its own implementation; call-count
// assertions rely on the (no-call → call) test ordering instead.

describe('CareWatchlist row-expand', () => {
  it('links the member name to the Member 360 page (not the Care History page)', () => {
    renderList();
    const href = screen.getByText('Whale_A').closest('a')?.getAttribute('href');
    expect(href).toContain('/segments/s1/members/111');
    expect(href).not.toContain('/care');
  });

  it('does not fetch until a row is expanded', () => {
    renderList();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lazy-fetches and renders summary cards (label + snippet + security badge) on expand', async () => {
    fetchMock.mockResolvedValue(payload([ticket()]));
    renderList();
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByText('Payment_FailedTransaction')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('s1', '111');
    expect(screen.getByText(/top-up failed/i)).toBeTruthy();
    expect(screen.getByText('Security')).toBeTruthy();
    // "View full care history" link also targets /care
    expect(screen.getByText(/View full care history/i).closest('a')?.getAttribute('href')).toContain('/members/111/care');
  });

  it('shows an empty note when the member has no joinable tickets', async () => {
    fetchMock.mockResolvedValue(payload([]));
    renderList();
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByText(/No joinable CS tickets/i)).toBeTruthy());
  });

  it('shows an error row when the fetch fails', async () => {
    // async-throw (rejects a microtask later) so the component's await handler is
    // attached before rejection — avoids a vitest false unhandled-rejection report.
    fetchMock.mockImplementation(async () => {
      throw new Error('trino down');
    });
    renderList();
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText(/Could not load CS tickets/i)).toBeTruthy();
  });
});
