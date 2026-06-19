/**
 * Genre-lever knowledge library — resolver + benchmark invariants.
 *
 * Guards the load-bearing behaviors: per-genre selection, the per-game
 * data-gate (withhold, never guess), the blind-spot surface, fail-closed on an
 * empty member set, and the "no source → no external norm" rule. The cross-game
 * honesty checks (jus never recommends clan/gacha/PvP) are regression tripwires:
 * a future edit that leaks them must fail here.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveLeversForGame,
  ALL_LEVERS,
} from '../src/knowledge/genre-levers/lever-library-index.js';
import {
  percentileOf,
  bandsFromValues,
} from '../src/knowledge/percentile-snapshot-store.js';
import { isSourcedNorm } from '../src/knowledge/benchmark-resolver.js';

/** Member set covering every required cube EXCEPT guild (jus_vn reality). */
function jusMembersWithoutGuild(): Set<string> {
  const s = new Set<string>();
  for (const lv of ALL_LEVERS) {
    if (lv.id === 'mmorpg-guild-social-retention') continue;
    for (const c of lv.requiredCubes) s.add(c);
  }
  return s;
}

describe('resolveLeversForGame — cfm_vn (competitive FPS)', () => {
  const res = resolveLeversForGame('cfm_vn', new Set(), { skipDataGate: true });

  it('resolves the FPS genre', () => {
    expect(res.genre).toBe('competitive-fps');
  });

  it('surfaces the core FPS levers', () => {
    const ids = res.levers.map((l) => l.id);
    expect(ids).toContain('fps-clan-social-retention');
    expect(ids).toContain('fps-whale-cause-typed-care');
    expect(ids).toContain('fps-first-purchase-conversion');
  });

  it('treats cheating as a blind spot, never an action', () => {
    const blindIds = res.blindSpots.map((b) => b.id);
    expect(blindIds).toContain('fps-competitive-integrity-cheating');
    // The blind spot must not appear as an actionable lever.
    expect(res.levers.map((l) => l.id)).not.toContain('fps-competitive-integrity-cheating');
  });
});

describe('resolveLeversForGame — jus_vn (social MMORPG)', () => {
  const res = resolveLeversForGame('jus_vn', jusMembersWithoutGuild());

  it('resolves the MMORPG genre', () => {
    expect(res.genre).toBe('social-mmorpg');
  });

  it('withholds the guild lever with its missing cubes (jus has no guild data)', () => {
    const guild = res.withheld.find((w) => w.id === 'mmorpg-guild-social-retention');
    expect(guild).toBeDefined();
    expect(guild?.missingCubes).toContain('guild_membership.guild_id');
  });

  it('never recommends clan / gacha / PvP levers (data-gate honesty)', () => {
    const ids = [...res.levers, ...res.blindSpots].map((l) => l.id);
    for (const id of ids) {
      expect(id).not.toMatch(/clan|gacha|crate|pvp/i);
    }
  });

  it('does surface MMORPG-appropriate levers', () => {
    const ids = res.levers.map((l) => l.id);
    expect(ids).toContain('mmorpg-server-health-merges');
    expect(ids).toContain('mmorpg-vip-tier-thresholds');
    expect(ids).toContain('mmorpg-whale-care');
  });
});

describe('resolveLeversForGame — gating edges', () => {
  it('fail-closed: empty member set withholds every non-blind-spot lever', () => {
    const res = resolveLeversForGame('cfm_vn', new Set()); // gate on, no members
    expect(res.levers).toHaveLength(0);
    expect(res.withheld.length).toBeGreaterThan(0);
    // Blind spots are surfaced regardless of the data-gate.
    expect(res.blindSpots.length).toBeGreaterThan(0);
  });

  it('unknown game → null genre, nothing applies, no throw', () => {
    const res = resolveLeversForGame('nosuch_vn', new Set());
    expect(res.genre).toBeNull();
    expect(res.levers).toHaveLength(0);
    expect(res.withheld).toHaveLength(0);
    expect(res.blindSpots).toHaveLength(0);
  });
});

describe('percentile helpers', () => {
  it('computes linear-interpolated percentiles', () => {
    const xs = [1, 2, 3, 4]; // p50 = 2.5
    expect(percentileOf(xs, 50)).toBeCloseTo(2.5, 5);
    expect(percentileOf(xs, 25)).toBeCloseTo(1.75, 5);
  });

  it('handles empty + singleton samples', () => {
    expect(percentileOf([], 50)).toBe(0);
    expect(percentileOf([42], 90)).toBe(42);
  });

  it('bandsFromValues returns monotonically non-decreasing bands', () => {
    const b = bandsFromValues([10, 5, 20, 15, 30]);
    expect(b.p25).toBeLessThanOrEqual(b.p50);
    expect(b.p50).toBeLessThanOrEqual(b.p75);
    expect(b.p75).toBeLessThanOrEqual(b.p90);
  });
});

describe('benchmark external-norm sourcing gate', () => {
  it('accepts a fully-sourced norm', () => {
    expect(isSourcedNorm({ value: 20, unit: '%', source: 'X', citation: 'Y' })).toBe(true);
  });

  it('rejects a norm missing source or citation (no un-sourced numbers)', () => {
    expect(isSourcedNorm({ value: 20, unit: '%', source: '', citation: 'Y' })).toBe(false);
    expect(isSourcedNorm({ value: 20, unit: '%', source: 'X', citation: '  ' })).toBe(false);
    expect(isSourcedNorm(undefined)).toBe(false);
  });

  it('every authored external norm in the library is properly sourced', () => {
    for (const lv of ALL_LEVERS) {
      const norm = lv.benchmark.externalNorm;
      if (norm) expect(isSourcedNorm(norm)).toBe(true);
    }
  });
});
