/**
 * turn-detail-stop-reason.test.tsx — Phase-02
 *
 * Tests that StopReasonPill renders with correct color class/style per value,
 * and that TurnDetail renders Permission Decisions section when non-empty.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StopReasonPill } from '../stop-reason-pill';
import { TurnDetail } from '../turn-detail';
import { useDebugTurn } from '../use-debug-api';
import type { DebugTurn, PermissionDecision } from '../use-debug-api';

// Stub RawEventsAccordion to avoid real fetch
vi.mock('../raw-events-accordion', () => ({
  RawEventsAccordion: () => <div data-testid="raw-accordion" />,
}));

// vi.mock is hoisted — factory cannot close over outer consts.
// Use vi.fn() inside factory; grab reference via vi.mocked after import.
vi.mock('../use-debug-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../use-debug-api')>();
  return {
    ...actual,
    useDebugTurn: vi.fn(() => ({
      data: { llmCalls: [], toolInvocations: [], permissionDecisions: [] as PermissionDecision[] },
      isLoading: false,
      error: null,
    })),
  };
});

const baseTurn: DebugTurn = {
  id: 'turn-pill-1',
  role: 'assistant',
  text: 'Assistant output',
  createdAt: new Date().toISOString(),
  toolCalls: [],
  legacy: false,
  llmCallCount: 1,
  toolInvocationCount: 0,
  inputTokens: 100,
  outputTokens: 50,
  costUsd: 0.001,
  model: 'claude-test',
  skill: 'explore',
  durationMs: 1000,
  stopReason: 'end_turn',
  llmAuthLabel: null,
  cacheCreationTokens: null, // Phase-03 field
  cacheReadTokens: null,
  cacheHit: false,
  originalTurnId: null,
  originalSessionId: null,
};

// Typed reference to the hoisted mock for per-test control
const mockedUseDebugTurn = vi.mocked(useDebugTurn);

beforeEach(() => { vi.clearAllMocks(); });

// ---------------------------------------------------------------------------
// StopReasonPill color tests
// ---------------------------------------------------------------------------

describe('StopReasonPill', () => {
  it('renders end_turn with green background', () => {
    const { container } = render(<StopReasonPill value="end_turn" />);
    const span = container.querySelector('span')!;
    expect(span.textContent).toBe('end_turn');
    expect(span.style.background).toBe('rgb(220, 252, 231)'); // #dcfce7
  });

  it('renders tool_use with amber background', () => {
    const { container } = render(<StopReasonPill value="tool_use" />);
    const span = container.querySelector('span')!;
    expect(span.style.background).toBe('rgb(254, 243, 199)'); // #fef3c7
  });

  it('renders max_tokens with red background', () => {
    const { container } = render(<StopReasonPill value="max_tokens" />);
    const span = container.querySelector('span')!;
    expect(span.style.background).toBe('rgb(254, 226, 226)'); // #fee2e2
  });

  it('renders refusal with red background', () => {
    const { container } = render(<StopReasonPill value="refusal" />);
    const span = container.querySelector('span')!;
    expect(span.style.background).toBe('rgb(254, 226, 226)');
  });

  it('renders pause_turn with red background', () => {
    const { container } = render(<StopReasonPill value="pause_turn" />);
    const span = container.querySelector('span')!;
    expect(span.style.background).toBe('rgb(254, 226, 226)');
  });

  it('renders null as — with neutral background', () => {
    const { container } = render(<StopReasonPill value={null} />);
    const span = container.querySelector('span')!;
    expect(span.textContent).toBe('—');
    expect(span.style.background).toBe('rgb(243, 244, 246)'); // #f3f4f6
  });

  it('renders unknown value with neutral background', () => {
    const { container } = render(<StopReasonPill value="stop_sequence" />);
    const span = container.querySelector('span')!;
    expect(span.style.background).toBe('rgb(243, 244, 246)');
  });
});

// ---------------------------------------------------------------------------
// TurnDetail — permission decisions section
// ---------------------------------------------------------------------------

describe('TurnDetail — Permission Decisions section', () => {
  it('does not render Permission Decisions section when array is empty', async () => {
    mockedUseDebugTurn.mockReturnValue({
      data: { llmCalls: [], toolInvocations: [], permissionDecisions: [] },
      isLoading: false,
      error: null,
    });

    render(<TurnDetail turn={baseTurn} index={0} />);
    fireEvent.click(screen.getByText('Assistant'));

    await waitFor(() => expect(screen.getByText(/LLM Calls/)).toBeTruthy());
    expect(screen.queryByText(/Permission Decisions/)).toBeNull();
  });

  it('renders Permission Decisions section when array is non-empty', async () => {
    const decisions: PermissionDecision[] = [
      { id: 'pd-1', turn_id: 'turn-pill-1', tool_name: 'Bash', decision: 'denied', reason: 'blocked', at: Date.now() },
    ];
    mockedUseDebugTurn.mockReturnValue({
      data: { llmCalls: [], toolInvocations: [], permissionDecisions: decisions },
      isLoading: false,
      error: null,
    });

    render(<TurnDetail turn={baseTurn} index={0} />);
    fireEvent.click(screen.getByText('Assistant'));

    await waitFor(() => expect(screen.getByText(/Permission Decisions \(1\)/)).toBeTruthy());
    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.getByText('denied')).toBeTruthy();
  });
});
