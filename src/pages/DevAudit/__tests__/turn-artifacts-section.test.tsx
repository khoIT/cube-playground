/**
 * Tests for TurnArtifactsSection (chat-audit artifacts cards):
 *   1. renders nothing for empty/undefined artifacts
 *   2. renders ordinal, title, source badge, game, ref and chart pill
 *   3. "Cube query" toggle reveals member chips + raw JSON fallback
 *   4. "Open in Playground" writes sessionStorage (session-storage variant)
 *      and navigates with the deeplink path
 *   5. ArtifactCountBadge pluralizes and hides at zero
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { TurnArtifactsSection, ArtifactCountBadge } from '../turn-artifacts-section';
import type { QueryArtifact } from '../../../api/chat-sse-client';

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter initialEntries={['/dev/chat-audit/sessions/s1']}>
      <Route path="/dev/chat-audit/sessions/s1">{children}</Route>
      <Route path="/build" render={() => <div data-testid="playground" />} />
    </MemoryRouter>
  );
}

const METRIC_ARTIFACT: QueryArtifact = {
  id: 'art-1',
  title: 'Daily Active Users — last 30 days',
  summary: 'Unique logins per day',
  game: 'cfm_vn',
  query: {
    measures: ['mf_users.dau'],
    timeDimensions: [{ dimension: 'mf_users.log_date', granularity: 'day', dateRange: 'last 30 days' }],
    filters: [{ member: 'mf_users.region', operator: 'equals', values: ['VN'] }],
  },
  source: 'business-metric',
  sourceRef: { id: 'dau', name: 'mf_users.dau' },
  previewRows: 30,
  deeplinkUrl: '#/build?from-chat-artifact=art-1',
  deeplinkVia: 'session-storage',
  payload: { measures: ['mf_users.dau'] },
  chart: {
    id: 'chart-1',
    spec: { type: 'line', title: 'DAU', data: [], encoding: { category: 'x', value: 'y' } },
    truncated: false,
    originalRowCount: 30,
  },
};

const RAW_ARTIFACT: QueryArtifact = {
  id: 'art-2',
  title: 'Recharge by channel',
  summary: '',
  query: { measures: ['user_recharge_daily.total_amount'] },
  source: 'raw',
  deeplinkUrl: '#/build?query=%7B%7D',
  deeplinkVia: 'inline',
  payload: null,
};

describe('TurnArtifactsSection', () => {
  beforeEach(() => sessionStorage.clear());

  it('renders nothing when artifacts are missing or empty', () => {
    const { container: c1 } = render(<TurnArtifactsSection artifacts={undefined} />, { wrapper: Wrapper });
    expect(c1.firstChild).toBeNull();
    const { container: c2 } = render(<TurnArtifactsSection artifacts={[]} />, { wrapper: Wrapper });
    expect(c2.firstChild).toBeNull();
  });

  it('renders ordinal, title, source badge, game, ref and chart pill', () => {
    render(<TurnArtifactsSection artifacts={[METRIC_ARTIFACT, RAW_ARTIFACT]} />, { wrapper: Wrapper });
    expect(screen.getByText('Artifacts (2)')).toBeTruthy();
    expect(screen.getByText('A1')).toBeTruthy();
    expect(screen.getByText('A2')).toBeTruthy();
    expect(screen.getByText('Daily Active Users — last 30 days')).toBeTruthy();
    expect(screen.getByText('Metric')).toBeTruthy();
    expect(screen.getByText('Raw Query')).toBeTruthy();
    expect(screen.getByText('cfm_vn')).toBeTruthy();
    expect(screen.getByText('mf_users.dau')).toBeTruthy();
    expect(screen.getByText('30 preview rows')).toBeTruthy();
    expect(screen.getByText('line chart')).toBeTruthy();
  });

  it('toggle reveals member chips and raw JSON fallback', () => {
    render(<TurnArtifactsSection artifacts={[METRIC_ARTIFACT]} />, { wrapper: Wrapper });
    expect(screen.queryByText('Measures')).not.toBeTruthy();

    fireEvent.click(screen.getByText('▸ Cube query'));
    expect(screen.getByText('Measures')).toBeTruthy();
    // measure chip + meta-row ref both say mf_users.dau
    expect(screen.getAllByText('mf_users.dau').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('mf_users.log_date · day · last 30 days')).toBeTruthy();
    expect(screen.getByText('mf_users.region equals VN')).toBeTruthy();

    fireEvent.click(screen.getByText('view raw JSON'));
    expect(screen.getByText(/"measures"/)).toBeTruthy();
  });

  it('Open in Playground writes sessionStorage and navigates', () => {
    render(<TurnArtifactsSection artifacts={[METRIC_ARTIFACT]} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Open in Playground ↗'));

    const stored = sessionStorage.getItem('gds-cube:pending-chat-deeplink:art-1');
    expect(stored).toBe(JSON.stringify(METRIC_ARTIFACT.payload));
    // Navigation landed on /build (nonce param appended by the shared helper).
    expect(screen.getByTestId('playground')).toBeTruthy();
  });
});

describe('ArtifactCountBadge', () => {
  it('hides at zero and pluralizes above one', () => {
    const { container } = render(<ArtifactCountBadge count={0} />);
    expect(container.firstChild).toBeNull();
    render(<ArtifactCountBadge count={1} />);
    expect(screen.getByText('1 artifact')).toBeTruthy();
    render(<ArtifactCountBadge count={3} />);
    expect(screen.getByText('3 artifacts')).toBeTruthy();
  });
});
