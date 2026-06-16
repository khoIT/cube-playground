/**
 * Auto-build selection: pick a game with ≥1 unbuilt rollup, never one that is
 * all-built ("ignore if we already handle"), and honour the per-game cooldown so
 * the 5-min collector doesn't recreate the worker every pass for a rollup that
 * stays unbuilt.
 */

import { describe, expect, it } from 'vitest';
import {
  selectAutoBuildGame,
  isAutoBuildEnabled,
  AUTO_BUILD_COOLDOWN_MS,
} from '../src/services/preagg-auto-build.js';
import type { PreaggReadiness, ProbeStatus } from '../src/services/preagg-readiness.js';

/** Build a readiness probe from a compact {gameId: [statuses]} spec. */
function probeOf(spec: Record<string, ProbeStatus[]>): PreaggReadiness {
  return {
    generatedAt: '2026-06-16T00:00:00.000Z',
    games: Object.entries(spec).map(([id, statuses]) => ({
      id,
      label: id,
      cubes: statuses.map((status, i) => ({ cube: `cube_${i}`, status })),
      built: statuses.filter((s) => s === 'built').length,
      fromSource: statuses.filter((s) => s === 'from-source').length,
      unbuilt: statuses.filter((s) => s === 'unbuilt').length,
      errored: statuses.filter((s) => s === 'error').length,
    })),
  };
}

const NOW = 1_700_000_000_000;

describe('selectAutoBuildGame', () => {
  it('picks the first game with an unbuilt rollup', () => {
    const probe = probeOf({ alpha: ['built', 'from-source'], beta: ['built', 'unbuilt'] });
    expect(selectAutoBuildGame(probe, NOW, new Map())).toBe('beta');
  });

  it('returns null when every rollup is already built/serving', () => {
    const probe = probeOf({ alpha: ['built', 'from-source'], beta: ['built'] });
    expect(selectAutoBuildGame(probe, NOW, new Map())).toBeNull();
  });

  it('skips a game attempted within the cooldown, falling through to the next', () => {
    const probe = probeOf({ alpha: ['unbuilt'], beta: ['unbuilt'] });
    const last = new Map([['alpha', NOW - 1_000]]); // alpha just attempted
    expect(selectAutoBuildGame(probe, NOW, last)).toBe('beta');
  });

  it('re-eligible once the cooldown has elapsed', () => {
    const probe = probeOf({ alpha: ['unbuilt'] });
    const last = new Map([['alpha', NOW - AUTO_BUILD_COOLDOWN_MS - 1]]);
    expect(selectAutoBuildGame(probe, NOW, last)).toBe('alpha');
  });

  it('returns null when all unbuilt games are within cooldown', () => {
    const probe = probeOf({ alpha: ['unbuilt'] });
    const last = new Map([['alpha', NOW - 1_000]]);
    expect(selectAutoBuildGame(probe, NOW, last)).toBeNull();
  });
});

describe('isAutoBuildEnabled', () => {
  it('is off unless PREAGG_AUTO_BUILD_ENABLED === "true"', () => {
    const prev = process.env.PREAGG_AUTO_BUILD_ENABLED;
    try {
      delete process.env.PREAGG_AUTO_BUILD_ENABLED;
      expect(isAutoBuildEnabled()).toBe(false);
      process.env.PREAGG_AUTO_BUILD_ENABLED = 'true';
      expect(isAutoBuildEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.PREAGG_AUTO_BUILD_ENABLED;
      else process.env.PREAGG_AUTO_BUILD_ENABLED = prev;
    }
  });
});
