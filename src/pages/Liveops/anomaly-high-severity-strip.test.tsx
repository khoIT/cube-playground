/**
 * AnomalyHighSeverityStrip — hidden when 0 high; visible when ≥1 high.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AnomalyHighSeverityStrip } from './anomaly-high-severity-strip';
import type { AnomalyRow } from './anomaly-inbox/use-anomalies';

// ── Mock useAnomalies ─────────────────────────────────────────────────────────

const mockAnomalies: AnomalyRow[] = [];
vi.mock('./anomaly-inbox/use-anomalies', () => ({
  useAnomalies: () => ({ anomalies: mockAnomalies, loading: false, error: null }),
}));

const mockPush = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useHistory: () => ({ push: mockPush }) };
});

function makeRow(severity: 'low' | 'med' | 'high'): AnomalyRow {
  return {
    id: Math.random(),
    game: 'cfm',
    metric: 'active_daily.dau',
    severity,
    baseline: 1000,
    observed: 5000,
    ts: '2024-01-15',
    status: 'open',
    snooze_until: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe('AnomalyHighSeverityStrip', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockAnomalies.length = 0;
  });

  it('renders nothing when there are no high-severity anomalies', () => {
    const { container } = render(
      <MemoryRouter><AnomalyHighSeverityStrip gameId="cfm" /></MemoryRouter>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when only low/med anomalies exist', () => {
    mockAnomalies.push(makeRow('low'), makeRow('med'));
    const { container } = render(
      <MemoryRouter><AnomalyHighSeverityStrip gameId="cfm" /></MemoryRouter>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the strip when ≥1 high-severity anomaly exists', () => {
    mockAnomalies.push(makeRow('high'));
    render(<MemoryRouter><AnomalyHighSeverityStrip gameId="cfm" /></MemoryRouter>);
    expect(screen.getByText(/1 high-severity anomaly/i)).toBeTruthy();
  });

  it('shows plural text for multiple high-severity anomalies', () => {
    mockAnomalies.push(makeRow('high'), makeRow('high'));
    render(<MemoryRouter><AnomalyHighSeverityStrip gameId="cfm" /></MemoryRouter>);
    expect(screen.getByText(/2 high-severity anomalies/i)).toBeTruthy();
  });

  it('navigates to /liveops/anomalies?severity=high on click', () => {
    mockAnomalies.push(makeRow('high'));
    render(<MemoryRouter><AnomalyHighSeverityStrip gameId="cfm" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button'));
    expect(mockPush).toHaveBeenCalledWith('/liveops/anomalies?severity=high');
  });
});
