import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import {
  onPerfRender,
  resetPerfCounts,
  PerfProbe,
  type PerfCounts,
} from '../perf-probe';

function counts(): PerfCounts {
  return (window.__perfCounts ??= {});
}

describe('perf-probe counter logic', () => {
  beforeEach(() => {
    resetPerfCounts();
  });

  it('increments mount on first invocation', () => {
    onPerfRender('SidePanel', 'mount', 12, 12, 0, 12, new Set());
    expect(counts().SidePanel).toEqual({ mount: 1, update: 0, totalMs: 12 });
  });

  it('increments update on subsequent invocations and accumulates duration', () => {
    onPerfRender('SidePanel', 'mount', 10, 10, 0, 10, new Set());
    onPerfRender('SidePanel', 'update', 5, 5, 0, 5, new Set());
    onPerfRender('SidePanel', 'update', 3, 3, 0, 3, new Set());
    expect(counts().SidePanel).toEqual({ mount: 1, update: 2, totalMs: 18 });
  });

  it('keeps separate buckets per id', () => {
    onPerfRender('A', 'mount', 1, 1, 0, 1, new Set());
    onPerfRender('B', 'mount', 2, 2, 0, 2, new Set());
    onPerfRender('A', 'update', 4, 4, 0, 4, new Set());
    expect(counts().A).toEqual({ mount: 1, update: 1, totalMs: 5 });
    expect(counts().B).toEqual({ mount: 1, update: 0, totalMs: 2 });
  });

  it('resetPerfCounts() clears all buckets', () => {
    onPerfRender('X', 'mount', 1, 1, 0, 1, new Set());
    resetPerfCounts();
    expect(window.__perfCounts).toEqual({});
  });

  it('resetPerfCounts(id) clears only one bucket', () => {
    onPerfRender('Keep', 'mount', 1, 1, 0, 1, new Set());
    onPerfRender('Drop', 'mount', 1, 1, 0, 1, new Set());
    resetPerfCounts('Drop');
    expect(counts().Keep).toBeDefined();
    expect(counts().Drop).toBeUndefined();
  });

  it('ignores nested-update phase silently', () => {
    onPerfRender('X', 'nested-update', 7, 7, 0, 7, new Set());
    expect(counts().X).toEqual({ mount: 0, update: 0, totalMs: 7 });
  });
});

describe('PerfProbe component', () => {
  beforeEach(() => {
    resetPerfCounts();
  });

  it('renders children', () => {
    const { getByTestId } = render(
      <PerfProbe id="probe-children-test">
        <span data-testid="child">hi</span>
      </PerfProbe>
    );
    expect(getByTestId('child').textContent).toBe('hi');
  });

  it('writes a counter bucket for its id during dev render', () => {
    render(
      <PerfProbe id="probe-bucket-test">
        <span />
      </PerfProbe>
    );
    // In dev (import.meta.env.DEV is true in vitest), Profiler wraps children
    // and onPerfRender fires synchronously on mount.
    expect(window.__perfCounts?.['probe-bucket-test']).toBeDefined();
    expect(window.__perfCounts!['probe-bucket-test'].mount).toBeGreaterThanOrEqual(1);
  });
});
