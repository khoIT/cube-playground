/**
 * Unit tests for the FE feature-access gate. Covers the enable decision
 * (explicit flag wins, default-on except `admin`) and the route→feature map
 * used by the URL guard — in particular that it does NOT collapse the whole
 * `/catalog` tree to one feature the way the coarse telemetry mapper does.
 */

import { describe, expect, it } from 'vitest';

import { featureEnabled, featureForRoute } from './feature-access';
import type { AuthUser } from './auth-context';

function user(features?: Record<string, boolean>): AuthUser {
  return { id: 'u', username: 'u', role: 'viewer', allowedGames: [], features };
}

describe('featureEnabled', () => {
  it('defaults on for normal surfaces when no flag is set', () => {
    expect(featureEnabled(user(), 'liveops')).toBe(true);
    expect(featureEnabled(user({}), 'dashboards')).toBe(true);
  });

  it('defaults OFF for the sensitive admin surface', () => {
    expect(featureEnabled(user(), 'admin')).toBe(false);
  });

  it('an explicit flag wins over the default (both directions)', () => {
    expect(featureEnabled(user({ liveops: false }), 'liveops')).toBe(false);
    expect(featureEnabled(user({ admin: true }), 'admin')).toBe(true);
  });

  it('a null user (still bootstrapping) is treated as enabled', () => {
    expect(featureEnabled(null, 'segments')).toBe(true);
  });
});

describe('featureForRoute', () => {
  it('maps the data-model catalog routes to data-model (not metrics-catalog)', () => {
    expect(featureForRoute('/catalog/data-model')).toBe('data-model');
    expect(featureForRoute('/catalog/concept/measure/x.y')).toBe('data-model');
  });

  it('maps the metrics catalog routes to metrics-catalog', () => {
    expect(featureForRoute('/catalog/metrics')).toBe('metrics-catalog');
    expect(featureForRoute('/catalog/metric/abc')).toBe('metrics-catalog');
  });

  it('gates redirect-only data-model paths (no first-tick bypass)', () => {
    expect(featureForRoute('/catalog/models')).toBe('data-model');
    expect(featureForRoute('/catalog/cubes')).toBe('data-model');
    expect(featureForRoute('/schema')).toBe('data-model');
    // legacy measure detail → concept (data-model); must not swallow /metrics/*
    expect(featureForRoute('/metric/mf_users/user_count')).toBe('data-model');
    expect(featureForRoute('/metrics/new')).toBeNull();
  });

  it('maps the Data hub to data-model (reused key)', () => {
    expect(featureForRoute('/data')).toBe('data-model');
  });

  it('maps top-level feature surfaces', () => {
    expect(featureForRoute('/chat/123')).toBe('chats');
    expect(featureForRoute('/build')).toBe('playground');
    expect(featureForRoute('/liveops/cohort')).toBe('liveops');
    expect(featureForRoute('/dashboards/x')).toBe('dashboards');
    expect(featureForRoute('/segments')).toBe('segments');
  });

  it('returns null for non-gated routes (settings, glossary, drift, admin)', () => {
    expect(featureForRoute('/settings')).toBeNull();
    expect(featureForRoute('/catalog/glossary')).toBeNull();
    expect(featureForRoute('/drift-center')).toBeNull();
    // admin is owned by its role guard, not this map.
    expect(featureForRoute('/admin/access')).toBeNull();
  });
});
