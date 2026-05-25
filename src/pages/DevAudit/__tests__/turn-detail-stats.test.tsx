/**
 * Phase-03: formatTurnStats — cache hit % and I/O ratio rendering tests.
 * Tests the stat parts appended to the turn header compact strip.
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

/** Build a minimal assistant DebugTurn; override specific fields per test. */
function makeTurn(overrides: Partial<DebugTurn> = {}): DebugTurn {
  return {
    id: 'turn-stats-1',
    role: 'assistant',
    text: 'ok',
    createdAt: new Date().toISOString(),
    toolCalls: [],
    legacy: false,
    llmCallCount: 1,
    toolInvocationCount: 0,
    inputTokens: 1000,
    outputTokens: 400,
    costUsd: 0.002,
    model: 'claude-sonnet-4-6',
    skill: 'explore',
    durationMs: 1200,
    stopReason: 'end_turn',
    cacheCreationTokens: null,
    cacheReadTokens: null,
    cacheHit: false,
    originalTurnId: null,
    originalSessionId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: get the stats span text (it's in the header, not in expanded body)
// ---------------------------------------------------------------------------
function getStatsText(): string | null {
  // The stats span carries the tooltip title; select by title attribute prefix
  const span = document.querySelector<HTMLElement>('[title^="aggregate from final"]');
  return span?.textContent ?? null;
}

// ---------------------------------------------------------------------------
// cache% tests
// ---------------------------------------------------------------------------

describe('formatTurnStats — cache hit %', () => {
  it('renders cache% when both cache fields are present and denominator > 0', () => {
    render(<TurnDetail turn={makeTurn({ cacheReadTokens: 750, cacheCreationTokens: 250 })} index={0} />);
    // cache_read / (cache_read + cache_creation) = 750/1000 = 75%
    expect(getStatsText()).toContain('cache 75%');
  });

  it('renders cache 0% when cache_read is 0 but creation > 0', () => {
    render(<TurnDetail turn={makeTurn({ cacheReadTokens: 0, cacheCreationTokens: 500 })} index={0} />);
    // 0 / 500 = 0%
    expect(getStatsText()).toContain('cache 0%');
  });

  it('renders cache 100% when only reads (no creation in this turn)', () => {
    render(<TurnDetail turn={makeTurn({ cacheReadTokens: 1000, cacheCreationTokens: 0 })} index={0} />);
    // 1000 / 1000 = 100%
    expect(getStatsText()).toContain('cache 100%');
  });

  it('omits cache% when both are null (legacy turn)', () => {
    render(<TurnDetail turn={makeTurn({ cacheReadTokens: null, cacheCreationTokens: null })} index={0} />);
    expect(getStatsText()).not.toContain('cache');
  });

  it('omits cache% when denominator is 0 (both zero)', () => {
    render(<TurnDetail turn={makeTurn({ cacheReadTokens: 0, cacheCreationTokens: 0 })} index={0} />);
    expect(getStatsText()).not.toContain('cache');
  });

  it('omits cache% when one field is null', () => {
    render(<TurnDetail turn={makeTurn({ cacheReadTokens: 500, cacheCreationTokens: null })} index={0} />);
    expect(getStatsText()).not.toContain('cache');
  });

  it('rounds cache% to nearest integer', () => {
    // 1/3 ≈ 33.33% → rounds to 33%
    render(<TurnDetail turn={makeTurn({ cacheReadTokens: 1, cacheCreationTokens: 2 })} index={0} />);
    expect(getStatsText()).toContain('cache 33%');
  });
});

// ---------------------------------------------------------------------------
// io ratio tests
// ---------------------------------------------------------------------------

describe('formatTurnStats — I/O ratio', () => {
  it('renders io ratio when input and output are present', () => {
    // 400 / 1000 = 0.4x
    render(<TurnDetail turn={makeTurn({ inputTokens: 1000, outputTokens: 400 })} index={0} />);
    expect(getStatsText()).toContain('io 0.4x');
  });

  it('renders io ratio with 1 decimal place', () => {
    // 333 / 1000 = 0.333… → 0.3x
    render(<TurnDetail turn={makeTurn({ inputTokens: 1000, outputTokens: 333 })} index={0} />);
    expect(getStatsText()).toContain('io 0.3x');
  });

  it('omits io when inputTokens is null', () => {
    render(<TurnDetail turn={makeTurn({ inputTokens: null })} index={0} />);
    expect(getStatsText()).not.toContain('io');
  });

  it('omits io when inputTokens is 0 (divide-by-zero guard)', () => {
    render(<TurnDetail turn={makeTurn({ inputTokens: 0, outputTokens: 100 })} index={0} />);
    expect(getStatsText()).not.toContain('io');
  });

  it('omits io when outputTokens is null', () => {
    render(<TurnDetail turn={makeTurn({ outputTokens: null })} index={0} />);
    expect(getStatsText()).not.toContain('io');
  });
});

// ---------------------------------------------------------------------------
// Combined: both cache and io present
// ---------------------------------------------------------------------------

describe('formatTurnStats — combined cache + io', () => {
  it('renders all 7 parts when all data present', () => {
    const turn = makeTurn({
      inputTokens: 2000,
      outputTokens: 600,
      cacheReadTokens: 1500,
      cacheCreationTokens: 500,
    });
    render(<TurnDetail turn={turn} index={0} />);
    const text = getStatsText();
    // cache: 1500/(1500+500) = 75%, io: 600/2000 = 0.3x
    expect(text).toContain('cache 75%');
    expect(text).toContain('io 0.3x');
    expect(text).toContain(' in');
    expect(text).toContain(' out');
  });

  it('stats span has tooltip title explaining metrics', () => {
    render(<TurnDetail turn={makeTurn()} index={0} />);
    const span = document.querySelector<HTMLElement>('[title^="aggregate from final"]');
    expect(span).not.toBeNull();
    expect(span!.title).toContain('cache%');
    expect(span!.title).toContain('io');
  });
});
