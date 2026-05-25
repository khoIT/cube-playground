/**
 * Phase-06: TurnDetail cache-hit badge rendering tests.
 *
 * Verifies:
 *   - "Cache hit" badge visible when cacheHit=true
 *   - Badge is a link pointing to the original turn's session when
 *     originalTurnId + originalSessionId are provided
 *   - No badge when cacheHit=false
 *   - Fallback plain-text badge when originalSessionId is null
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TurnDetail } from '../turn-detail';
import type { DebugTurn } from '../use-debug-api';

vi.mock('../use-debug-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../use-debug-api')>();
  return {
    ...actual,
    useDebugTurn: vi.fn(() => ({
      data: { llmCalls: [], toolInvocations: [], permissionDecisions: [] },
      isLoading: false,
      error: null,
    })),
  };
});

vi.mock('../raw-events-accordion', () => ({
  RawEventsAccordion: () => <div data-testid="raw-accordion" />,
}));

const baseTurn: DebugTurn = {
  id: 'turn-cache-1',
  role: 'assistant',
  text: 'Cached reply text',
  createdAt: new Date().toISOString(),
  toolCalls: [],
  legacy: false,
  llmCallCount: 0,
  toolInvocationCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  model: 'claude-test',
  skill: 'explore',
  durationMs: 10,
  stopReason: 'end_turn',
  cacheCreationTokens: null,
  cacheReadTokens: null,
  cacheHit: true,
  originalTurnId: 'orig-turn-abc',
  originalSessionId: 'orig-session-xyz',
};

describe('TurnDetail — cache hit badge', () => {
  it('shows "Cache hit" badge when cacheHit=true', () => {
    render(<TurnDetail turn={baseTurn} index={0} />);
    expect(screen.getByText('Cache hit')).toBeTruthy();
  });

  it('badge is a link to the original session + turn anchor', () => {
    render(<TurnDetail turn={baseTurn} index={0} />);
    const link = screen.getByText('Cache hit').closest('a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toContain('orig-session-xyz');
    expect(link!.getAttribute('href')).toContain('orig-turn-abc');
  });

  it('does NOT show badge when cacheHit=false', () => {
    const nonCached = { ...baseTurn, cacheHit: false, originalTurnId: null, originalSessionId: null };
    render(<TurnDetail turn={nonCached} index={0} />);
    expect(screen.queryByText('Cache hit')).toBeNull();
  });

  it('renders plain span badge when originalSessionId is null', () => {
    const noSession = { ...baseTurn, originalSessionId: null };
    render(<TurnDetail turn={noSession} index={0} />);
    const badge = screen.getByText('Cache hit');
    expect(badge).toBeTruthy();
    // Should be a span, not an anchor
    expect(badge.tagName.toLowerCase()).toBe('span');
  });
});
