/**
 * Tests for the drag-reorder logic used in StepEvents.
 * The reorder logic is extracted inline here to test without a DOM renderer.
 *
 * Logic mirrors StepEvents.handleDrop:
 *   splice item at dragIdx out, then insert at toIdx.
 */

import { describe, it, expect } from 'vitest';

function reorder(list: string[], fromIdx: number, toIdx: number): string[] {
  if (fromIdx === toIdx) return list;
  const next = [...list];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

describe('drag-reorder', () => {
  it('moves first item to last position', () => {
    expect(reorder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('moves last item to first position', () => {
    expect(reorder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('swaps adjacent items', () => {
    expect(reorder(['a', 'b', 'c'], 1, 2)).toEqual(['a', 'c', 'b']);
  });

  it('no-ops when fromIdx === toIdx', () => {
    const list = ['a', 'b', 'c'];
    expect(reorder(list, 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('preserves list length', () => {
    const list = ['login', 'purchase', 'review', 'repeat'];
    const result = reorder(list, 0, 3);
    expect(result).toHaveLength(4);
  });

  it('does not mutate the original array', () => {
    const original = ['a', 'b', 'c'];
    reorder(original, 0, 2);
    expect(original).toEqual(['a', 'b', 'c']);
  });

  it('handles two-item list forward', () => {
    expect(reorder(['first', 'second'], 0, 1)).toEqual(['second', 'first']);
  });

  it('handles two-item list backward', () => {
    expect(reorder(['first', 'second'], 1, 0)).toEqual(['second', 'first']);
  });

  it('moves item from middle to start', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 2, 0)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('moves item from middle to end', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 1, 3)).toEqual(['a', 'c', 'd', 'b']);
  });
});

describe('event list add/remove logic', () => {
  const MAX_EVENTS = 6;
  const MIN_EVENTS = 2;

  function canAdd(events: string[], candidate: string): boolean {
    return (
      candidate.trim().length > 0 &&
      !events.includes(candidate.trim()) &&
      events.length < MAX_EVENTS
    );
  }

  function removeAt(events: string[], idx: number): string[] {
    return events.filter((_, i) => i !== idx);
  }

  it('allows adding unique events up to MAX_EVENTS', () => {
    const events = ['a', 'b', 'c', 'd', 'e'];
    expect(canAdd(events, 'f')).toBe(true);
    expect(canAdd([...events, 'f'], 'g')).toBe(false); // now at 6
  });

  it('rejects duplicate event names', () => {
    expect(canAdd(['login', 'purchase'], 'login')).toBe(false);
  });

  it('rejects empty or whitespace names', () => {
    expect(canAdd(['login'], '')).toBe(false);
    expect(canAdd(['login'], '   ')).toBe(false);
  });

  it('removes item at correct index', () => {
    expect(removeAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });

  it('step count below MIN_EVENTS is invalid', () => {
    expect(['a'].length >= MIN_EVENTS).toBe(false);
    expect(['a', 'b'].length >= MIN_EVENTS).toBe(true);
  });
});
