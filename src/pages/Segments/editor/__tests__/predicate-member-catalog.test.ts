/**
 * Unit tests for the predicate member catalog builder.
 *
 * Tests cover: catalog grouping from a meta fixture, type mapping,
 * connectedComponent reachability (only primary + same-component cubes included),
 * model segments extraction, and the degraded path (missing cube → empty catalog).
 *
 * The meta fixture intentionally has NO `joins[]` on any cube — mirroring the
 * real /meta?extended=true response shape where join reachability comes from
 * `connectedComponent`, not `joins[]`. This ensures the old joins-based lookup
 * would NOT find mf_users from active_daily, proving the fix is load-bearing.
 */

import { describe, it, expect } from 'vitest';

// Pure buildCatalog is now exported for direct testing.
import { buildCatalog } from '../predicate-builder/use-predicate-member-catalog';
import type { RawMetaCube } from '../predicate-builder/use-predicate-member-catalog';

// The catalog builder is not exported separately, so we test it via the
// types and by verifying the module's cache helpers. We import the pure
// buildCatalog logic by re-implementing it from the spec — the real test
// is the unit behaviour of the exported hook, which we exercise via the
// cache-seeding pattern below.

// Instead, test the canonical sort helper which is fully pure and exported.
import { canonicallySortSegments } from '../../slice-scope/parse-cube-segments';

// And the reset/prime helpers from the suggestions cache.
import {
  _resetSuggestionsCache,
  _primeSuggestionsCache,
} from '../predicate-builder/use-dim-value-suggestions';

// ── canonicallySortSegments ────────────────────────────────────────────────

describe('canonicallySortSegments', () => {
  it('sorts alphabetically', () => {
    expect(canonicallySortSegments(['z', 'a', 'm'])).toEqual(['a', 'm', 'z']);
  });

  it('is stable on an already-sorted input', () => {
    const input = ['a', 'b', 'c'];
    expect(canonicallySortSegments(input)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the original array', () => {
    const original = ['c', 'a', 'b'];
    canonicallySortSegments(original);
    expect(original).toEqual(['c', 'a', 'b']);
  });

  it('handles an empty array', () => {
    expect(canonicallySortSegments([])).toEqual([]);
  });

  it('handles fully-qualified cube segment names', () => {
    expect(
      canonicallySortSegments([
        'mf_users.zzz_seg',
        'mf_users.aaa_seg',
        'active_daily.last_30d',
      ]),
    ).toEqual(['active_daily.last_30d', 'mf_users.aaa_seg', 'mf_users.zzz_seg']);
  });
});

// ── suggestions cache helpers ──────────────────────────────────────────────

describe('suggestions cache helpers', () => {
  it('_resetSuggestionsCache clears without throwing', () => {
    _primeSuggestionsCache('ws::game::dim', ['pc', 'mobile']);
    expect(() => _resetSuggestionsCache()).not.toThrow();
  });

  it('_primeSuggestionsCache stores and returns values', () => {
    _resetSuggestionsCache();
    const result = _primeSuggestionsCache('ws::game::mf_users.os_platform', ['pc', 'mobile', 'console']);
    expect(result.values).toEqual(['pc', 'mobile', 'console']);
  });
});

// ── catalog type-mapping logic (pure function extracted inline for test) ────

type LeafType = 'string' | 'number' | 'time' | 'boolean';

function toCatalogType(raw: string | undefined): LeafType {
  if (!raw) return 'string';
  if (
    raw === 'number' || raw === 'count' || raw === 'sum' || raw === 'avg' ||
    raw === 'min' || raw === 'max' || raw === 'countDistinct' || raw === 'runningTotal'
  ) return 'number';
  if (raw === 'time') return 'time';
  if (raw === 'boolean') return 'boolean';
  return 'string';
}

describe('catalog type mapper', () => {
  it('maps Cube numeric measure types to number', () => {
    for (const t of ['number', 'count', 'sum', 'avg', 'min', 'max', 'countDistinct', 'runningTotal']) {
      expect(toCatalogType(t)).toBe('number');
    }
  });

  it('maps time to time', () => {
    expect(toCatalogType('time')).toBe('time');
  });

  it('maps boolean to boolean', () => {
    expect(toCatalogType('boolean')).toBe('boolean');
  });

  it('maps string / unknown types to string', () => {
    expect(toCatalogType('string')).toBe('string');
    expect(toCatalogType('geo')).toBe('string');
    expect(toCatalogType(undefined)).toBe('string');
  });
});

// ── catalog grouping via real /meta shape ──────────────────────────────────
//
// This fixture mirrors the ACTUAL Cube /meta?extended=true response shape:
//   - connectedComponent is present on each cube
//   - NO joins[] arrays (the SDK strips them; the raw response doesn't include
//     them at the top-level cube object in the format we consume)
//
// This means the OLD joins-based buildCatalog would find `primary.joins = []`
// and therefore only include active_daily — mf_users would be MISSING.
// The new connectedComponent-based logic must include mf_users.

const META_CUBES: RawMetaCube[] = [
  {
    name: 'active_daily',
    connectedComponent: 1,
    dimensions: [
      { name: 'active_daily.uid', type: 'string' },
      { name: 'active_daily.os_platform', type: 'string' },
      { name: 'active_daily.log_date', type: 'time' },
    ],
    measures: [
      { name: 'active_daily.count', type: 'count' },
      { name: 'active_daily.revenue', type: 'number' },
    ],
    segments: [
      { name: 'active_daily.last_30d', title: 'Last 30 days' },
      { name: 'active_daily.daily_active', title: 'Daily active' },
    ],
    // No joins[] — mirrors real /meta?extended=true shape
  },
  {
    name: 'mf_users',
    connectedComponent: 1,   // same component as active_daily → reachable
    dimensions: [
      { name: 'mf_users.uid', type: 'string' },
      { name: 'mf_users.ltv_tier', type: 'string' },
    ],
    measures: [{ name: 'mf_users.ltv_total', type: 'number' }],
    segments: [{ name: 'mf_users.whales', title: 'Whales' }],
  },
  {
    name: 'unrelated_cube',
    connectedComponent: 2,   // different component → must be excluded
    dimensions: [{ name: 'unrelated_cube.col', type: 'string' }],
  },
];

describe('catalog grouping from meta fixture (connectedComponent-based)', () => {
  it('includes primary cube and same-component cubes, excludes different-component cubes', () => {
    const { groups } = buildCatalog(META_CUBES, 'active_daily');
    const cubeNames = groups.map((g) => g.cube);
    expect(cubeNames).toContain('active_daily');
    expect(cubeNames).toContain('mf_users');
    expect(cubeNames).not.toContain('unrelated_cube');
  });

  it('places primary cube first regardless of alphabetical order', () => {
    const { groups } = buildCatalog(META_CUBES, 'active_daily');
    expect(groups[0].cube).toBe('active_daily');
  });

  it('sorts component-peer groups alphabetically after the primary', () => {
    // Add a second peer to verify ordering.
    const cubesWithExtra: RawMetaCube[] = [
      ...META_CUBES,
      {
        name: 'zzz_cube',
        connectedComponent: 1,
        dimensions: [{ name: 'zzz_cube.x', type: 'string' }],
      },
      {
        name: 'aaa_cube',
        connectedComponent: 1,
        dimensions: [{ name: 'aaa_cube.x', type: 'string' }],
      },
    ];
    const { groups } = buildCatalog(cubesWithExtra, 'active_daily');
    const names = groups.map((g) => g.cube);
    expect(names[0]).toBe('active_daily');
    // Peers in alpha order: aaa_cube, mf_users, zzz_cube
    expect(names.slice(1)).toEqual(['aaa_cube', 'mf_users', 'zzz_cube']);
  });

  it('includes dimensions as members', () => {
    const { byName } = buildCatalog(META_CUBES, 'active_daily');
    expect(byName.has('active_daily.os_platform')).toBe(true);
    expect(byName.get('active_daily.os_platform')?.type).toBe('string');
  });

  it('includes mf_users dimensions — would fail against old joins-based logic', () => {
    // Old logic: primary.joins = [] (no joins[] in fixture) → mf_users excluded.
    // New logic: connectedComponent = 1 on both → mf_users included.
    const { byName } = buildCatalog(META_CUBES, 'active_daily');
    expect(byName.has('mf_users.uid')).toBe(true);
    expect(byName.has('mf_users.ltv_tier')).toBe(true);
  });

  it('includes mf_users numeric measures — would fail against old joins-based logic', () => {
    const { byName } = buildCatalog(META_CUBES, 'active_daily');
    expect(byName.has('mf_users.ltv_total')).toBe(true);
    expect(byName.get('mf_users.ltv_total')?.type).toBe('number');
  });

  it('includes numeric measures as members', () => {
    const { byName } = buildCatalog(META_CUBES, 'active_daily');
    expect(byName.has('active_daily.revenue')).toBe(true);
    expect(byName.get('active_daily.revenue')?.type).toBe('number');
  });

  it('auto-sets type to number for count measures', () => {
    const { byName } = buildCatalog(META_CUBES, 'active_daily');
    expect(byName.get('active_daily.count')?.type).toBe('number');
  });

  it('exposes model segments for the chip panel', () => {
    const { modelSegments } = buildCatalog(META_CUBES, 'active_daily');
    const names = modelSegments.map((s) => s.name);
    expect(names).toContain('active_daily.last_30d');
    expect(names).toContain('active_daily.daily_active');
    // Component-peer cube's segments also included
    expect(names).toContain('mf_users.whales');
  });

  it('returns empty catalog when primary cube not in meta', () => {
    const { groups, byName, modelSegments } = buildCatalog(META_CUBES, 'missing_cube');
    expect(groups).toHaveLength(0);
    expect(byName.size).toBe(0);
    expect(modelSegments).toHaveLength(0);
  });

  it('degrades to primary-only when primary has no connectedComponent', () => {
    const cubesNoComponent: RawMetaCube[] = [
      {
        name: 'active_daily',
        // No connectedComponent
        dimensions: [{ name: 'active_daily.uid', type: 'string' }],
      },
      {
        name: 'mf_users',
        // No connectedComponent either
        dimensions: [{ name: 'mf_users.uid', type: 'string' }],
      },
    ];
    const { groups } = buildCatalog(cubesNoComponent, 'active_daily');
    expect(groups).toHaveLength(1);
    expect(groups[0].cube).toBe('active_daily');
  });
});
