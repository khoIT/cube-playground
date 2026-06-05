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
  resolveMemberMeta,
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
      measures: [
        { name: 'mf_users.arpu_vnd' },
        { name: 'mf_users.count' },
        { name: 'mf_users.ltv_total_vnd', shortTitle: 'Total LTV (VND)', title: 'mf_users Total LTV' },
      ],
      dimensions: [
        { name: 'mf_users.id', type: 'string' },
        { name: 'mf_users.country', type: 'string', title: 'Country' },
        { name: 'mf_users.days_since_last_active', type: 'number' },
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

  describe('resolveMemberMeta', () => {
    it('resolves a measure to its shortTitle + numeric/measure', () => {
      expect(resolveMemberMeta(META, 'mf_users.ltv_total_vnd')).toEqual({
        label: 'Total LTV (VND)',
        dataType: 'number',
        kind: 'measure',
      });
    });

    it('falls back to title then humanised leaf when no shortTitle', () => {
      // measure without titles → humanised leaf
      expect(resolveMemberMeta(META, 'mf_users.arpu_vnd').label).toBe('Arpu vnd');
      // dimension with only a title → title
      expect(resolveMemberMeta(META, 'mf_users.country').label).toBe('Country');
    });

    it('classifies a numeric dimension as number/dimension', () => {
      expect(resolveMemberMeta(META, 'mf_users.days_since_last_active')).toEqual({
        label: 'Days since last active',
        dataType: 'number',
        kind: 'dimension',
      });
    });

    it('classifies a time dimension as time/timeDimension', () => {
      const r = resolveMemberMeta(META, 'recharge.created_at');
      expect(r.dataType).toBe('time');
      expect(r.kind).toBe('timeDimension');
    });

    it('resolves a granular time-dim key (cube.member.day) on the stem', () => {
      const r = resolveMemberMeta(META, 'recharge.created_at.day');
      expect(r.kind).toBe('timeDimension');
    });

    it('best-effort humanises an unknown member', () => {
      expect(resolveMemberMeta(META, 'unknown.some_col')).toEqual({
        label: 'Some col',
        dataType: 'string',
        kind: 'dimension',
      });
    });
  });
});
