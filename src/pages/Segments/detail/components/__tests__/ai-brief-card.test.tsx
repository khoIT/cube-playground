/**
 * AiBriefCard — state machine (skeleton/ok/limited/error+retry), mandatory
 * byline, collapse persistence + lazy fetch when collapsed at mount, language
 * refetch, and plain-text rendering of LLM output.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
// Real i18n init so t() interpolates {{count}}/{{when}} (user-menu test pattern).
import i18n from '../../../../../i18n';
import { segmentsClient } from '../../../../../api/segments-client';
import type { SegmentBriefResponse } from '../../../../../api/segments-client';

vi.mock('../../../../../api/segments-client', async () => {
  const actual = await vi.importActual<typeof import('../../../../../api/segments-client')>(
    '../../../../../api/segments-client',
  );
  return { ...actual, segmentsClient: { ...actual.segmentsClient, getBrief: vi.fn() } };
});

import { AiBriefCard } from '../ai-brief-card';

const COLLAPSE_KEY = 'gds-cube:segment-brief-collapsed';

function okResponse(over: Partial<SegmentBriefResponse['brief']> = {}, stale = false): SegmentBriefResponse {
  return {
    segment_id: 'seg1',
    lang: 'en',
    status: 'ok',
    ...(stale ? { stale: true } : {}),
    brief: {
      label: 'high_value_churn_risk',
      narrative: 'Big spenders going quiet. They drive revenue. Watch the lapse window.',
      signals: ['Median LTV 4.9× game average', '64% lapsing or churned'],
      data_coverage: 'full',
      generated_at: new Date().toISOString(),
      member_count: 14203,
      definition_hash: 'abc123',
      ...over,
    },
    generated_at: new Date().toISOString(),
  };
}

beforeEach(async () => {
  vi.mocked(segmentsClient.getBrief).mockReset();
  localStorage.removeItem(COLLAPSE_KEY);
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

describe('AiBriefCard', () => {
  it('shows a skeleton, then the brief with chip + narrative + signals + MANDATORY byline', async () => {
    let resolve!: (v: SegmentBriefResponse) => void;
    vi.mocked(segmentsClient.getBrief).mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<AiBriefCard segmentId="seg1" />);

    expect(screen.getByTestId('brief-skeleton')).toBeTruthy();
    await act(async () => resolve(okResponse()));

    expect(screen.getByText('High-value churn risk')).toBeTruthy();
    expect(screen.getByText(/Big spenders going quiet/)).toBeTruthy();
    expect(screen.getByText(/Median LTV 4.9/)).toBeTruthy();
    // Byline is non-negotiable: count + "AI-generated" must always render.
    expect(screen.getByText(/AI-generated · estimated · 14,203 members ·/)).toBeTruthy();
    expect(segmentsClient.getBrief).toHaveBeenCalledWith('seg1', 'en', false);
  });

  it('renders the limited-coverage disclaimer chip for limited briefs', async () => {
    vi.mocked(segmentsClient.getBrief).mockResolvedValue(okResponse({ data_coverage: 'limited' }));
    render(<AiBriefCard segmentId="seg1" />);
    await waitFor(() => expect(screen.getByText('Limited data — predicate analysis only')).toBeTruthy());
  });

  it('error → quiet one-line state; Retry refetches with refresh=1', async () => {
    vi.mocked(segmentsClient.getBrief)
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockResolvedValueOnce(okResponse());
    render(<AiBriefCard segmentId="seg1" />);

    await waitFor(() => expect(screen.getByText("Couldn't generate the brief.")).toBeTruthy());
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText(/Big spenders going quiet/)).toBeTruthy());
    expect(segmentsClient.getBrief).toHaveBeenLastCalledWith('seg1', 'en', true);
  });

  it('collapsed at mount issues NO fetch until expanded; collapse persists', async () => {
    localStorage.setItem(COLLAPSE_KEY, '1');
    vi.mocked(segmentsClient.getBrief).mockResolvedValue(okResponse());
    render(<AiBriefCard segmentId="seg1" />);

    expect(segmentsClient.getBrief).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Expand AI brief'));
    await waitFor(() => expect(screen.getByText(/Big spenders going quiet/)).toBeTruthy());
    expect(segmentsClient.getBrief).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(COLLAPSE_KEY)).toBe('0');

    fireEvent.click(screen.getByLabelText('Collapse AI brief'));
    expect(localStorage.getItem(COLLAPSE_KEY)).toBe('1');
  });

  it('switching the UI language refetches with the new lang', async () => {
    vi.mocked(segmentsClient.getBrief).mockResolvedValue(okResponse());
    render(<AiBriefCard segmentId="seg1" />);
    await waitFor(() => expect(segmentsClient.getBrief).toHaveBeenCalledWith('seg1', 'en', false));

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    await waitFor(() => expect(segmentsClient.getBrief).toHaveBeenCalledWith('seg1', 'vi', false));
  });

  it('renders LLM output as plain text — markup is NOT interpreted', async () => {
    vi.mocked(segmentsClient.getBrief).mockResolvedValue(
      okResponse({ narrative: '<img src=x onerror=alert(1)> <b>bold</b> cohort' }),
    );
    const { container } = render(<AiBriefCard segmentId="seg1" />);
    await waitFor(() => expect(screen.getByText(/bold.*cohort/)).toBeTruthy());
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('server error-status rows surface the retryable error state', async () => {
    vi.mocked(segmentsClient.getBrief).mockResolvedValue({
      segment_id: 'seg1',
      lang: 'en',
      status: 'error',
      brief: null,
      error: 'chat-service responded 502',
      generated_at: new Date().toISOString(),
    });
    render(<AiBriefCard segmentId="seg1" />);
    await waitFor(() => expect(screen.getByText("Couldn't generate the brief.")).toBeTruthy());
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('stale brief shows the outdated chip alongside the narrative + byline', async () => {
    vi.mocked(segmentsClient.getBrief).mockResolvedValue(okResponse({}, true));
    render(<AiBriefCard segmentId="seg1" />);
    await waitFor(() => expect(screen.getByText('Outdated — definition changed')).toBeTruthy());
    expect(screen.getByText(/AI-generated · estimated/)).toBeTruthy();
  });
});
