/**
 * AuthLanePill — session-header auth-lane pill rendering tests.
 *
 * Verifies:
 *   - hidden when no turn carries an llmAuthLabel (legacy sessions)
 *   - shows the latest non-null lane as a one-word pill
 *   - tooltip lists the failover path when multiple lanes were used
 *   - unknown lane labels render verbatim (forward-compat)
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AuthLanePill, resolveSessionAuthLane } from '../auth-lane-pill';
import type { DebugTurn } from '../use-debug-api-types';

function turn(role: 'user' | 'assistant', llmAuthLabel: string | null): DebugTurn {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text: 'x',
    createdAt: new Date().toISOString(),
    toolCalls: [],
    legacy: false,
    llmCallCount: 0,
    toolInvocationCount: 0,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    model: null,
    skill: null,
    durationMs: null,
    stopReason: null,
    llmAuthLabel,
    cacheCreationTokens: null,
    cacheReadTokens: null,
    cacheHit: false,
    originalTurnId: null,
    originalSessionId: null,
  };
}

describe('resolveSessionAuthLane', () => {
  it('returns null when no assistant turn carries a label', () => {
    expect(resolveSessionAuthLane([turn('user', null), turn('assistant', null)])).toBeNull();
  });

  it('picks the latest non-null label and the distinct history in order', () => {
    const turns = [
      turn('user', null),
      turn('assistant', 'primary'),
      turn('assistant', 'primary'),
      turn('assistant', 'stg'),
      turn('assistant', 'subscription'),
    ];
    expect(resolveSessionAuthLane(turns)).toEqual({
      lane: 'subscription',
      history: ['primary', 'stg', 'subscription'],
    });
  });

  it('ignores labels on user turns', () => {
    // A user turn never carries a lane in practice; guard against bad data.
    const turns = [turn('user', 'backup'), turn('assistant', 'primary')];
    expect(resolveSessionAuthLane(turns)!.lane).toBe('primary');
  });
});

describe('AuthLanePill', () => {
  it('renders nothing for a legacy session', () => {
    render(<AuthLanePill turns={[turn('assistant', null)]} />);
    expect(screen.queryByTestId('auth-lane-pill')).toBeNull();
  });

  it('shows one word for the final lane', () => {
    render(<AuthLanePill turns={[turn('assistant', 'subscription')]} />);
    expect(screen.getByTestId('auth-lane-pill').textContent).toBe('Subscription');
  });

  it('tooltip carries the failover path when lanes changed mid-session', () => {
    render(
      <AuthLanePill turns={[turn('assistant', 'primary'), turn('assistant', 'backup')]} />,
    );
    const pill = screen.getByTestId('auth-lane-pill');
    expect(pill.textContent).toBe('Backup');
    expect(pill.getAttribute('title')).toBe('Auth lane history: primary → backup');
  });

  it('renders an unknown lane label verbatim', () => {
    render(<AuthLanePill turns={[turn('assistant', 'mystery-lane')]} />);
    expect(screen.getByTestId('auth-lane-pill').textContent).toBe('mystery-lane');
  });
});
