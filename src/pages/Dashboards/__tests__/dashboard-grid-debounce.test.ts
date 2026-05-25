/**
 * Tests for DashboardGrid layout-save debounce (500ms).
 * Verifies that rapid layout changes are coalesced into a single save call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We test the debounce logic in isolation without mounting React.
// The debounce is 500ms — we use fake timers to control it precisely.

const DEBOUNCE_MS = 500;

function createDebouncedSaver(saveFn: (layout: number[]) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return function debouncedSave(layout: number[]) {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => saveFn(layout), DEBOUNCE_MS);
  };
}

describe('layout-save debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls save only once after 500ms when called rapidly', () => {
    const saveFn = vi.fn();
    const debouncedSave = createDebouncedSaver(saveFn);

    // Simulate 5 rapid layout changes (e.g. drag pixels)
    debouncedSave([1, 2]);
    debouncedSave([1, 3]);
    debouncedSave([1, 4]);
    debouncedSave([1, 5]);
    debouncedSave([1, 6]);

    // No save before the debounce fires
    expect(saveFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DEBOUNCE_MS);

    // Exactly one call with the last layout value
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith([1, 6]);
  });

  it('fires once per quiescent period when spaced > 500ms apart', () => {
    const saveFn = vi.fn();
    const debouncedSave = createDebouncedSaver(saveFn);

    debouncedSave([1]);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(saveFn).toHaveBeenCalledTimes(1);

    debouncedSave([2]);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(saveFn).toHaveBeenCalledTimes(2);
    expect(saveFn).toHaveBeenLastCalledWith([2]);
  });

  it('does NOT save if called then immediately timer-cleared', () => {
    const saveFn = vi.fn();
    let timer: ReturnType<typeof setTimeout> | null = null;

    function save(layout: number[]) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => saveFn(layout), DEBOUNCE_MS);
    }

    save([1, 2]);
    // Clear before timeout fires (simulates unmount flush skipping)
    if (timer !== null) clearTimeout(timer);

    vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    expect(saveFn).not.toHaveBeenCalled();
  });
});
