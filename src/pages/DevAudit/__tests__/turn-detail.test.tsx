/**
 * Render tests for TurnDetail component.
 * Verifies legacy badge display, expand behaviour, and Langfuse link detection.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TurnDetail } from '../turn-detail';
import type { DebugTurn } from '../use-debug-api';

// Mock useDebugTurn so component doesn't need a real API
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

// Mock RawEventsAccordion to isolate TurnDetail logic
vi.mock('../raw-events-accordion', () => ({
  RawEventsAccordion: ({ turnId }: { turnId: string }) => (
    <div data-testid="raw-accordion">{turnId}</div>
  ),
}));

const baseTurn: DebugTurn = {
  id: 'turn-abc',
  role: 'assistant',
  text: 'System prompt text here',
  createdAt: new Date().toISOString(),
  toolCalls: [],
  legacy: false,
  llmCallCount: 2,
  toolInvocationCount: 1,
  inputTokens: 1234,
  outputTokens: 567,
  costUsd: 0.0182,
  model: 'claude-sonnet-4-6',
  skill: 'explore',
  durationMs: 4200,
  stopReason: 'end_turn', // Phase-02 field
  llmAuthLabel: null,
  cacheCreationTokens: null, // Phase-03 field
  cacheReadTokens: null,
  cacheHit: false,
  originalTurnId: null,
  originalSessionId: null,
};

const legacyTurn: DebugTurn = { ...baseTurn, legacy: true, llmCallCount: 0, toolInvocationCount: 0 };
const userTurn: DebugTurn = { ...baseTurn, role: 'user', text: 'Hello from user' };

beforeEach(() => { vi.clearAllMocks(); });

describe('TurnDetail — user turn', () => {
  it('renders user message text directly without expand toggle', () => {
    render(<TurnDetail turn={userTurn} index={0} />);
    expect(screen.getByText('Hello from user')).toBeTruthy();
    // No expand arrow for user turns
    expect(screen.queryByText('▼')).toBeNull();
  });
});

describe('TurnDetail — legacy assistant turn', () => {
  it('shows Legacy badge', () => {
    render(<TurnDetail turn={legacyTurn} index={1} />);
    expect(screen.getByText('Legacy')).toBeTruthy();
  });

  it('shows degraded message after expanding', () => {
    render(<TurnDetail turn={legacyTurn} index={1} />);
    // Click header to expand
    fireEvent.click(screen.getByText('Assistant'));
    expect(screen.getByText(/predates the observability feature/i)).toBeTruthy();
  });

  it('does not render LLM calls section for legacy turns', () => {
    render(<TurnDetail turn={legacyTurn} index={1} />);
    fireEvent.click(screen.getByText('Assistant'));
    expect(screen.queryByText(/LLM Calls/)).toBeNull();
  });
});

describe('TurnDetail — normal assistant turn', () => {
  it('collapses by default — no body content visible', () => {
    render(<TurnDetail turn={baseTurn} index={0} />);
    expect(screen.queryByText(/LLM Calls/)).toBeNull();
    expect(screen.queryByTestId('raw-accordion')).toBeNull();
  });

  it('expands on header click and shows sections', async () => {
    render(<TurnDetail turn={baseTurn} index={0} />);
    fireEvent.click(screen.getByText('Assistant'));
    await waitFor(() => {
      expect(screen.getByText(/LLM Calls/)).toBeTruthy();
      expect(screen.getByText(/Tool Invocations/)).toBeTruthy();
      expect(screen.getByTestId('raw-accordion')).toBeTruthy();
    });
  });

  it('collapses again on second header click', async () => {
    render(<TurnDetail turn={baseTurn} index={0} />);
    fireEvent.click(screen.getByText('Assistant'));
    await waitFor(() => expect(screen.queryByTestId('raw-accordion')).toBeTruthy());
    fireEvent.click(screen.getByText('Assistant'));
    expect(screen.queryByTestId('raw-accordion')).toBeNull();
  });

  it('passes correct turnId to RawEventsAccordion', async () => {
    render(<TurnDetail turn={baseTurn} index={0} />);
    fireEvent.click(screen.getByText('Assistant'));
    await waitFor(() => expect(screen.getByTestId('raw-accordion').textContent).toBe('turn-abc'));
  });
});

describe('TurnDetail — Langfuse deep link', () => {
  it('hides Langfuse button when VITE_LANGFUSE_HOST is not set', () => {
    // import.meta.env.VITE_LANGFUSE_HOST is undefined in test env by default
    render(<TurnDetail turn={baseTurn} index={0} />);
    expect(screen.queryByText('Open in Langfuse')).toBeNull();
  });
});
