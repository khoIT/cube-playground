/**
 * Tests for the ordered-cube detection contract.
 *
 * These are pure logic tests — they call the internal detectOrderedCube
 * function indirectly by testing what the hook would derive from a given
 * meta shape. Since the hook's detection logic is a closed function, we
 * re-implement the detection contract inline here to keep tests dependency-free
 * (no React renderer needed).
 */

import { describe, it, expect } from 'vitest';

// ── Re-implement the detection contract from use-funnel-detection.ts ──
// Keeping this inline avoids importing the hook (which pulls in React context).

interface MetaMeasure { name: string }
interface MetaDimension { name: string }
interface MetaCube {
  name: string;
  measures?: MetaMeasure[];
  dimensions?: MetaDimension[];
}

function detectOrderedCube(cubes: MetaCube[]): string | null {
  for (const cube of cubes) {
    const hasMeasure = (cube.measures ?? []).some((m) => m.name.endsWith('.step_count'));
    const hasStepIndex = (cube.dimensions ?? []).some((d) => d.name.endsWith('.step_index'));
    const hasStepName = (cube.dimensions ?? []).some((d) => d.name.endsWith('.step_name'));
    if (hasMeasure && hasStepIndex && hasStepName) return cube.name;
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────

describe('detectOrderedCube (detection contract)', () => {
  it('returns cube name when all three contract members present', () => {
    const cubes: MetaCube[] = [
      {
        name: 'ordered_event_funnel',
        measures: [{ name: 'ordered_event_funnel.step_count' }],
        dimensions: [
          { name: 'ordered_event_funnel.step_index' },
          { name: 'ordered_event_funnel.step_name' },
        ],
      },
    ];
    expect(detectOrderedCube(cubes)).toBe('ordered_event_funnel');
  });

  it('returns null when step_count measure is missing', () => {
    const cubes: MetaCube[] = [
      {
        name: 'ordered_event_funnel',
        measures: [{ name: 'ordered_event_funnel.user_count' }],
        dimensions: [
          { name: 'ordered_event_funnel.step_index' },
          { name: 'ordered_event_funnel.step_name' },
        ],
      },
    ];
    expect(detectOrderedCube(cubes)).toBeNull();
  });

  it('returns null when step_index dimension is missing', () => {
    const cubes: MetaCube[] = [
      {
        name: 'ordered_event_funnel',
        measures: [{ name: 'ordered_event_funnel.step_count' }],
        dimensions: [{ name: 'ordered_event_funnel.step_name' }],
      },
    ];
    expect(detectOrderedCube(cubes)).toBeNull();
  });

  it('returns null when step_name dimension is missing', () => {
    const cubes: MetaCube[] = [
      {
        name: 'ordered_event_funnel',
        measures: [{ name: 'ordered_event_funnel.step_count' }],
        dimensions: [{ name: 'ordered_event_funnel.step_index' }],
      },
    ];
    expect(detectOrderedCube(cubes)).toBeNull();
  });

  it('returns null for an empty cube list', () => {
    expect(detectOrderedCube([])).toBeNull();
  });

  it('returns null when measures/dimensions are undefined', () => {
    const cubes: MetaCube[] = [{ name: 'some_cube' }];
    expect(detectOrderedCube(cubes)).toBeNull();
  });

  it('finds the matching cube among multiple cubes', () => {
    const cubes: MetaCube[] = [
      {
        name: 'active_daily',
        measures: [{ name: 'active_daily.dau' }],
        dimensions: [{ name: 'active_daily.date' }],
      },
      {
        name: 'ordered_event_funnel',
        measures: [{ name: 'ordered_event_funnel.step_count' }],
        dimensions: [
          { name: 'ordered_event_funnel.step_index' },
          { name: 'ordered_event_funnel.step_name' },
        ],
      },
      {
        name: 'recharge',
        measures: [{ name: 'recharge.revenue' }],
        dimensions: [],
      },
    ];
    expect(detectOrderedCube(cubes)).toBe('ordered_event_funnel');
  });

  it('matches by suffix, not full name — custom prefix allowed', () => {
    const cubes: MetaCube[] = [
      {
        name: 'game_event_funnel',
        measures: [{ name: 'game_event_funnel.step_count' }],
        dimensions: [
          { name: 'game_event_funnel.step_index' },
          { name: 'game_event_funnel.step_name' },
        ],
      },
    ];
    expect(detectOrderedCube(cubes)).toBe('game_event_funnel');
  });
});
