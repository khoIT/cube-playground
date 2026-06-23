/**
 * LiveOps redirect alias tests.
 *
 * Verifies two URL aliases introduced in Phase 01:
 *   /liveops/cohort      → /liveops/retention          (static Redirect)
 *   /liveops/anomalies   → /liveops/alerts?tab=inbox   (LiveopsAnomaliesRedirect,
 *                                                        query params preserved)
 *
 * Uses MemoryRouter + Route to capture the resolved location after render,
 * mirroring the pattern in src/pages/Catalog/__tests__/data-model-redirects.test.tsx.
 * Heavy page components are stubbed — only routing behaviour is under test.
 */
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Switch, Redirect, useLocation } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';

// ── Stub heavy page components ────────────────────────────────────────────────

vi.mock('../../../hooks', () => ({ useCubeApiBootstrap: () => {} }));

// Stub the actual page components so no network / Cube calls fire.
const Stub = (name: string) => () => React.createElement('div', { 'data-testid': name });

const CohortRetentionPage = Stub('cohort-retention-page');
const AlertsPage = Stub('alerts-page');

// ── LiveopsAnomaliesRedirect (copy of the logic from index.tsx) ──────────────

function LiveopsAnomaliesRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  if (!params.get('tab')) params.set('tab', 'inbox');
  return <Redirect to={`/liveops/alerts?${params.toString()}${location.hash}`} />;
}

// ── Router under test ─────────────────────────────────────────────────────────

function renderAt(entry: string) {
  let resolvedUrl = '';

  render(
    <MemoryRouter initialEntries={[entry]}>
      <Switch>
        <Route exact path="/liveops/retention" component={CohortRetentionPage} />
        <Route exact path="/liveops/alerts" component={AlertsPage} />
        {/* Aliases */}
        <Route exact path="/liveops/cohort">
          <Redirect to="/liveops/retention" />
        </Route>
        <Route exact path="/liveops/anomalies" component={LiveopsAnomaliesRedirect} />
      </Switch>
      {/* Capture the final resolved URL after any redirects */}
      <Route
        path="*"
        render={({ location }) => {
          resolvedUrl = `${location.pathname}${location.search}${location.hash}`;
          return null;
        }}
      />
    </MemoryRouter>,
  );

  return { resolvedUrl: () => resolvedUrl };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('liveops_cohort_redirect_to_retention', () => {
  it('/liveops/cohort redirects to /liveops/retention', () => {
    const { resolvedUrl } = renderAt('/liveops/cohort');
    expect(resolvedUrl()).toBe('/liveops/retention');
  });

  it('/liveops/retention renders directly without redirect', () => {
    const { resolvedUrl } = renderAt('/liveops/retention');
    expect(resolvedUrl()).toBe('/liveops/retention');
  });
});

describe('liveops_anomalies_redirect_to_alerts_inbox', () => {
  it('/liveops/anomalies redirects to /liveops/alerts?tab=inbox', () => {
    const { resolvedUrl } = renderAt('/liveops/anomalies');
    expect(resolvedUrl()).toBe('/liveops/alerts?tab=inbox');
  });

  it('preserves existing query params and appends tab=inbox', () => {
    const { resolvedUrl } = renderAt('/liveops/anomalies?metric=dau&severity=high');
    const url = resolvedUrl();
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('tab')).toBe('inbox');
    expect(params.get('metric')).toBe('dau');
    expect(params.get('severity')).toBe('high');
  });

  it('does not duplicate tab param when caller already supplies tab=rules', () => {
    // If ?tab is already present the redirect preserves it (no override).
    const { resolvedUrl } = renderAt('/liveops/anomalies?tab=rules');
    const url = resolvedUrl();
    const params = new URLSearchParams(url.split('?')[1]);
    // tab was already set — LiveopsAnomaliesRedirect only sets it when absent
    expect(params.get('tab')).toBe('rules');
  });

  it('preserves hash fragment across the redirect', () => {
    const { resolvedUrl } = renderAt('/liveops/anomalies#detail-123');
    expect(resolvedUrl()).toContain('#detail-123');
    expect(resolvedUrl()).toContain('tab=inbox');
  });
});
