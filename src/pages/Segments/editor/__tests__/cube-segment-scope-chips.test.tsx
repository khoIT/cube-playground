/**
 * Unit tests for CubeSegmentScopeChips.
 *
 * Covers: active/inactive chip rendering, toggle (add/remove), owner-gate
 * disabling, cross-cube read-only entries, and the confirm-dialog guard for
 * the last time-bounding segment.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CubeSegmentScopeChips } from '../cube-segment-scope-chips';
import type { ModelSegmentEntry } from '../predicate-builder/use-predicate-member-catalog';

// antd Modal.confirm is imperative — stub it so confirm fires onOk synchronously.
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    Modal: {
      ...actual.Modal,
      confirm: vi.fn(({ onOk }: { onOk?: () => void }) => {
        // Simulate user clicking "Remove anyway" in tests.
        onOk?.();
      }),
    },
  };
});

const PRIMARY_CUBE = 'active_daily';

const MODEL_SEGMENTS: ModelSegmentEntry[] = [
  { name: 'active_daily.last_30d', title: 'Last 30 days', cube: PRIMARY_CUBE },
  { name: 'active_daily.daily_active', title: 'Daily active', cube: PRIMARY_CUBE },
  { name: 'active_daily.weekly_active', title: 'Weekly active', cube: PRIMARY_CUBE },
];

function renderChips(
  opts: Partial<{
    activeSegments: string[];
    canAdminister: boolean;
    onChange: (next: string[]) => void;
    modelSegments: ModelSegmentEntry[];
  }> = {},
) {
  const onChange = opts.onChange ?? vi.fn();
  render(
    <CubeSegmentScopeChips
      modelSegments={opts.modelSegments ?? MODEL_SEGMENTS}
      activeSegments={opts.activeSegments ?? []}
      primaryCube={PRIMARY_CUBE}
      canAdminister={opts.canAdminister ?? true}
      onChange={onChange}
    />,
  );
  return { onChange };
}

describe('CubeSegmentScopeChips rendering', () => {
  it('renders all model segment chips', () => {
    renderChips({ activeSegments: [] });
    expect(screen.getByText('Last 30 days')).toBeTruthy();
    expect(screen.getByText('Daily active')).toBeTruthy();
    expect(screen.getByText('Weekly active')).toBeTruthy();
  });

  it('returns null when no model segments and no active segments', () => {
    const { container } = render(
      <CubeSegmentScopeChips
        modelSegments={[]}
        activeSegments={[]}
        primaryCube={PRIMARY_CUBE}
        canAdminister
        onChange={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('disables chips when canAdminister is false', () => {
    renderChips({ canAdminister: false });
    // All primary-cube chips render as disabled antd buttons.
    const buttons = screen.getAllByRole('button') as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of buttons) {
      expect(btn.disabled).toBe(true);
    }
  });
});

describe('CubeSegmentScopeChips toggling (owner)', () => {
  it('calls onChange with segment added when an inactive chip is clicked', () => {
    const onChange = vi.fn();
    renderChips({ activeSegments: [], onChange });
    fireEvent.click(screen.getByText('Daily active'));
    expect(onChange).toHaveBeenCalledOnce();
    const [next] = onChange.mock.calls[0] as [string[]];
    expect(next).toContain('active_daily.daily_active');
  });

  it('calls onChange with segment removed when an active chip is clicked', () => {
    const onChange = vi.fn();
    renderChips({
      activeSegments: ['active_daily.last_30d', 'active_daily.daily_active'],
      onChange,
    });
    // Click the active "Daily active" chip to deactivate it.
    fireEvent.click(screen.getByText('Daily active'));
    const [next] = onChange.mock.calls[0] as [string[]];
    expect(next).not.toContain('active_daily.daily_active');
    expect(next).toContain('active_daily.last_30d');
  });

  it('does not call onChange when a disabled chip is clicked', () => {
    const onChange = vi.fn();
    renderChips({ canAdminister: false, onChange });
    fireEvent.click(screen.getByText('Daily active'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('CubeSegmentScopeChips — last time-bounding segment guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls Modal.confirm when removing the sole time-bounding segment', async () => {
    const { Modal } = await import('antd');
    const onChange = vi.fn();
    // Only one active segment and it contains a date-ish token.
    renderChips({
      activeSegments: ['active_daily.last_30d'],
      onChange,
    });
    fireEvent.click(screen.getByText('Last 30 days'));
    expect(Modal.confirm).toHaveBeenCalledOnce();
    // The stub fires onOk synchronously, so onChange should have been called.
    expect(onChange).toHaveBeenCalledOnce();
    const [next] = onChange.mock.calls[0] as [string[]];
    expect(next).not.toContain('active_daily.last_30d');
  });

  it('does NOT show confirm when another time-bounding segment remains', async () => {
    const { Modal } = await import('antd');
    const onChange = vi.fn();
    // Two time-bounding segments active — removing one is safe.
    renderChips({
      activeSegments: ['active_daily.last_30d', 'active_daily.weekly_active'],
      onChange,
    });
    fireEvent.click(screen.getByText('Last 30 days'));
    expect(Modal.confirm).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledOnce();
  });
});

describe('CubeSegmentScopeChips — cross-cube read-only entries', () => {
  it('renders cross-cube sidecar entries as read-only chips (not buttons)', () => {
    const crossCubeActive = ['mf_users.whales'];
    render(
      <CubeSegmentScopeChips
        modelSegments={MODEL_SEGMENTS}
        activeSegments={[...crossCubeActive]}
        primaryCube={PRIMARY_CUBE}
        canAdminister
        onChange={vi.fn()}
      />,
    );
    // The cross-cube chip renders as a <span> with the cube label, not a button.
    expect(screen.getByText(/whales/i)).toBeTruthy();
    // It must NOT be inside a clickable button.
    const whalesEl = screen.getByText(/whales/i).closest('button');
    expect(whalesEl).toBeNull();
  });

  it('preserves cross-cube entries in onChange when toggling a primary chip', () => {
    const onChange = vi.fn();
    render(
      <CubeSegmentScopeChips
        modelSegments={MODEL_SEGMENTS}
        activeSegments={['mf_users.whales']}
        primaryCube={PRIMARY_CUBE}
        canAdminister
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText('Daily active'));
    const [next] = onChange.mock.calls[0] as [string[]];
    // Cross-cube entry preserved.
    expect(next).toContain('mf_users.whales');
    // Primary chip added.
    expect(next).toContain('active_daily.daily_active');
  });
});
