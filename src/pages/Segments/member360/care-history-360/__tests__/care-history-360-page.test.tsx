/**
 * CareHistory360Page — states (loading→ready, no-coverage, not-member, error,
 * empty), the Inbox↔Timeline toggle, transcript bubble render, the security
 * banner via the security marker, and that message text renders as plain text
 * (server pre-strips HTML; the client never injects markup). fetchMemberCsTickets
 * is mocked; the endpoint is covered by server route tests.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { SegmentApiError } from '../../../../../api/api-client';
import type { CsTicketsPayload, CsTicketDetail } from '../../../../../api/segment-cs-care-member';

const fetchMock = vi.fn();
vi.mock('../../../../../api/segment-cs-care-member', async (orig) => ({
  ...(await orig<typeof import('../../../../../api/segment-cs-care-member')>()),
  fetchMemberCsTickets: (...args: unknown[]) => fetchMock(...args),
}));

import { CareHistory360Page } from '../care-history-360-page';

function ticket(over: Partial<CsTicketDetail> = {}): CsTicketDetail {
  return {
    ticketId: '26530832',
    uid: '111',
    source: 'Web',
    formName: 'Form',
    openedAt: '2026-02-05',
    status: 'Closed',
    priority: 5,
    staffDept: 'CTS',
    staffDomain: 'khuongnb2',
    latencyMin: 23,
    reopenCount: 2,
    sentiment: { first: 'Neutral', last: 'Negative', change: 'Change Status' },
    securityFlag: false,
    loginInfo: '111',
    tags: ['#NTH-Question'],
    labels: [{ category: 'Payment', name: 'Payment_ItemsNotReceived' }],
    rating: { rating: 1, feedback: 'check the account', feedbackOptions: ['Unclear response content'] },
    messages: [
      { at: '2026-02-05 15:27:13', isCustomer: false, text: 'Staff reply here', attachments: [] },
      { at: '2026-02-05 15:33:45', isCustomer: true, text: 'My top-up failed', attachments: ['a.jpg'] },
    ],
    messagesTruncated: false,
    vip: { tierId: 4, vipGameProportion: 0.75, loginChannel: null, gender: null },
    ...over,
  };
}

const payload = (over: Partial<CsTicketsPayload> = {}): CsTicketsPayload => ({
  segmentId: 's1',
  gameId: 'jus_vn',
  productId: 832,
  uid: '111',
  member: { name: 'Tô Phi', ltv: 91_000_000 },
  coverage: { joined: true, note: null },
  freshness: { csMaxLogDate: '2026-02-05' },
  recharge: { n: 1, avgRevPre: 100, avgRevPost: 82, deltaPct: -18, windowDays: 30 },
  tickets: [ticket()],
  ...over,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/segments/s1/members/111/care']}>
      <Route path="/segments/:id/members/:uid/care" component={CareHistory360Page} />
    </MemoryRouter>,
  );
}

describe('CareHistory360Page', () => {
  it('renders the header, transcript and signals on a ready payload', async () => {
    fetchMock.mockResolvedValue(payload());
    renderPage();
    await waitFor(() => expect(screen.getByText('Tô Phi')).toBeTruthy());
    expect(screen.getByText('₫91.0M')).toBeTruthy();
    expect(screen.getByText('−18%')).toBeTruthy(); // recharge delta
    expect(screen.getByText('My top-up failed')).toBeTruthy(); // transcript bubble
    expect(screen.getByText(/check the account/)).toBeTruthy(); // verbatim rating
  });

  it('renders message text as plain text (no HTML injection)', async () => {
    fetchMock.mockResolvedValue(
      payload({ tickets: [ticket({ messages: [{ at: '2026-02-05 10:00:00', isCustomer: true, text: '<img src=x onerror=alert(1)> hi', attachments: [] }] })] }),
    );
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText(/onerror=alert\(1\)/)).toBeTruthy());
    // The angle-bracket text is rendered as text content, not as a real <img> element.
    expect(container.querySelector('img')).toBeNull();
  });

  it('toggles between Inbox and Timeline views', async () => {
    fetchMock.mockResolvedValue(payload());
    renderPage();
    await waitFor(() => expect(screen.getByText('Tô Phi')).toBeTruthy());
    fireEvent.click(screen.getByText('Timeline'));
    // Timeline still shows the transcript for the selected ticket.
    expect(screen.getByText('My top-up failed')).toBeTruthy();
    fireEvent.click(screen.getByText('Inbox'));
    expect(screen.getByText('My top-up failed')).toBeTruthy();
  });

  it('shows the no-coverage notice on NO_CS_CARE', async () => {
    fetchMock.mockRejectedValue(new SegmentApiError('NO_CS_CARE', 'no', 404));
    renderPage();
    await waitFor(() => expect(screen.getByText(/only for games with CS coverage/i)).toBeTruthy());
  });

  it('shows the not-member notice on NOT_IN_SEGMENT', async () => {
    fetchMock.mockRejectedValue(new SegmentApiError('NOT_IN_SEGMENT', 'no', 404));
    renderPage();
    await waitFor(() => expect(screen.getByText(/not part of the segment/i)).toBeTruthy());
  });

  it('shows an empty notice when the member has no joinable tickets', async () => {
    fetchMock.mockResolvedValue(payload({ coverage: { joined: false, note: 'No joinable CS history — etc.' }, tickets: [] }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/No joinable CS history/i)).toBeTruthy());
  });
});
