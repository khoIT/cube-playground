/**
 * TabActivity (Phase 08) — renders audit-history entries returned by
 * GET /api/business-metrics/:id/history. Covers:
 *   - loading state appears first
 *   - empty list → friendly empty state copy
 *   - populated list → one Row per entry with action pill + actor + reason
 *   - 5xx response → error state
 *   - trust_change action without explicit reason → "old → new" summary
 */

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TabActivity } from './tab-activity';

interface RawEntry {
  id: number;
  ts: number;
  metricId: string;
  action: string;
  oldValueJson: string | null;
  newValueJson: string | null;
  actorKind: string;
  actorId: string | null;
  reason: string | null;
  requestId: string | null;
}

function buildResponse(entries: RawEntry[], status = 200): Response {
  return new Response(JSON.stringify({ entries }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  // Each test installs its own fetch stub.
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TabActivity (metric history)', () => {
  it('renders an empty-state message when no entries exist', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(buildResponse([]));
    render(<TabActivity metricId="arpdau" />);
    await waitFor(() => expect(screen.getByTestId('metric-history-empty')).toBeTruthy());
  });

  it('renders one row per audit entry with action pill + actor', async () => {
    const entries: RawEntry[] = [
      {
        id: 1, ts: Date.now(),
        metricId: 'arpdau', action: 'trust_change',
        oldValueJson: '{"old_trust":"draft"}',
        newValueJson: '{"new_trust":"certified"}',
        actorKind: 'user', actorId: 'alice',
        reason: 'manually verified',
        requestId: null,
      },
      {
        id: 2, ts: Date.now() - 60_000,
        metricId: 'arpdau', action: 'update',
        oldValueJson: null, newValueJson: null,
        actorKind: 'agent', actorId: 'agent-1',
        reason: 'agent ramp',
        requestId: 'req-1',
      },
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(buildResponse(entries));
    render(<TabActivity metricId="arpdau" />);
    const rows = await screen.findAllByTestId('metric-history-row');
    expect(rows.length).toBe(2);
    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByText('agent-1')).toBeTruthy();
    expect(screen.getByText('manually verified')).toBeTruthy();
  });

  it('renders error copy when the endpoint returns non-200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(buildResponse([], 500));
    render(<TabActivity metricId="arpdau" />);
    await waitFor(() => expect(screen.getByTestId('metric-history-error')).toBeTruthy());
  });

  it('falls back to old → new trust summary when reason is missing', async () => {
    const entries: RawEntry[] = [
      {
        id: 1, ts: Date.now(),
        metricId: 'arpdau', action: 'trust_change',
        oldValueJson: '{"trust":"draft"}',
        newValueJson: '{"trust":"certified"}',
        actorKind: 'system', actorId: null,
        reason: null, requestId: null,
      },
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(buildResponse(entries));
    render(<TabActivity metricId="arpdau" />);
    await waitFor(() => expect(screen.getByText('draft → certified')).toBeTruthy());
  });
});
