/**
 * Unit tests for cube-meta capability probes.
 * Synthetic /meta payload mirrors real Cube shape: cubes[].dimensions[].type.
 */

import { describe, it, expect } from 'vitest';
import {
  cubeHasTimeDimension,
  listTimeDimensions,
  primaryTimeDimensionOf,
  cubeNameOf,
} from '../../src/core/cube-meta-capability.js';

const META = {
  cubes: [
    {
      name: 'recharge',
      measures: [{ name: 'recharge.revenue_vnd' }],
      dimensions: [
        { name: 'recharge.created_at', type: 'time' },
        { name: 'recharge.channel', type: 'string' },
      ],
    },
    {
      name: 'mf_users',
      measures: [{ name: 'mf_users.arpu_vnd' }, { name: 'mf_users.count' }],
      dimensions: [
        { name: 'mf_users.id', type: 'string' },
        { name: 'mf_users.country', type: 'string' },
      ],
    },
  ],
};

describe('cube-meta-capability', () => {
  it('cubeHasTimeDimension returns true for a time-aware cube', () => {
    expect(cubeHasTimeDimension(META, 'recharge')).toBe(true);
  });

  it('cubeHasTimeDimension returns false for a snapshot cube', () => {
    expect(cubeHasTimeDimension(META, 'mf_users')).toBe(false);
  });

  it('cubeHasTimeDimension returns false for an unknown cube', () => {
    expect(cubeHasTimeDimension(META, 'nope')).toBe(false);
  });

  it('listTimeDimensions enumerates every type=time dim across the payload', () => {
    expect(listTimeDimensions(META)).toEqual(['recharge.created_at']);
  });

  it('primaryTimeDimensionOf returns the first time dim of the named cube', () => {
    expect(primaryTimeDimensionOf(META, 'recharge')).toBe('recharge.created_at');
    expect(primaryTimeDimensionOf(META, 'mf_users')).toBeNull();
  });

  it('cubeNameOf parses a dotted ref', () => {
    expect(cubeNameOf('recharge.revenue_vnd')).toBe('recharge');
    expect(cubeNameOf('lone_word')).toBeNull();
  });
});
