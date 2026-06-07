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

const CANONICAL_CUBE_SUFFIX = 'ordered_funnel_canonical';

function matchesStepContract(cube: MetaCube): boolean {
  const hasMeasure = (cube.measures ?? []).some((m) => m.name.endsWith('.step_count'));
  const hasStepIndex = (cube.dimensions ?? []).some((d) => d.name.endsWith('.step_index'));
  const hasStepName = (cube.dimensions ?? []).some((d) => d.name.endsWith('.step_name'));
  return hasMeasure && hasStepIndex && hasStepName;
}

interface DetectedCubes {
  cubeName: string | null;
  canonicalCubeName: string | null;
}

function detectBothCubes(cubes: MetaCube[]): DetectedCubes {
  let cubeName: string | null = null;
  let canonicalCubeName: string | null = null;
  for (const cube of cubes) {
    if (!matchesStepContract(cube)) continue;
    if (cube.name.endsWith(CANONICAL_CUBE_SUFFIX)) {
      canonicalCubeName = canonicalCubeName ?? cube.name;
    } else {
      cubeName = cubeName ?? cube.name;
    }
  }
  return { cubeName, canonicalCubeName };
}

/** Back-compat shim for the original single-cube assertions below. */
function detectOrderedCube(cubes: MetaCube[]): string | null {
  return detectBothCubes(cubes).cubeName;
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

  it('canonical cube never shadows the parametric cube, regardless of meta order', () => {
    const canonical: MetaCube = {
      name: 'ordered_funnel_canonical',
      measures: [{ name: 'ordered_funnel_canonical.step_count' }],
      dimensions: [
        { name: 'ordered_funnel_canonical.step_index' },
        { name: 'ordered_funnel_canonical.step_name' },
      ],
    };
    const parametric: MetaCube = {
      name: 'ordered_event_funnel',
      measures: [{ name: 'ordered_event_funnel.step_count' }],
      dimensions: [
        { name: 'ordered_event_funnel.step_index' },
        { name: 'ordered_event_funnel.step_name' },
      ],
    };
    // canonical listed FIRST — parametric must still win cubeName
    expect(detectBothCubes([canonical, parametric])).toEqual({
      cubeName: 'ordered_event_funnel',
      canonicalCubeName: 'ordered_funnel_canonical',
    });
  });

  it('canonical-only deployment reports absent parametric cube', () => {
    const canonical: MetaCube = {
      name: 'ordered_funnel_canonical',
      measures: [{ name: 'ordered_funnel_canonical.step_count' }],
      dimensions: [
        { name: 'ordered_funnel_canonical.step_index' },
        { name: 'ordered_funnel_canonical.step_name' },
      ],
    };
    expect(detectBothCubes([canonical])).toEqual({
      cubeName: null,
      canonicalCubeName: 'ordered_funnel_canonical',
    });
  });
});
