/**
 * Tests for the query-shape helpers: member summary + privacy-safe playground
 * deep-link. The shape is member NAMES only — the URL must carry exactly those
 * and nothing else (no filters/ranges exist to leak).
 */

import { describe, it, expect } from 'vitest';
import { summarizeShapeMembers, buildShapePlaygroundUrl, groupFeatures, type QueryShape } from './per-user-panel-helpers';
import type { AdminUser, AdminRegistry } from '../access/use-admin-access';

const shape = (over: Partial<QueryShape> = {}): QueryShape => ({
  cubes: [], measures: [], dimensions: [], ...over,
});

describe('summarizeShapeMembers', () => {
  it('joins measures and dimensions by name', () => {
    expect(summarizeShapeMembers(shape({ measures: ['recharge.revenue_vnd'], dimensions: ['recharge.user_id'] })))
      .toBe('recharge.revenue_vnd, recharge.user_id');
  });

  it('falls back to cube names when no members', () => {
    expect(summarizeShapeMembers(shape({ cubes: ['recharge'] }))).toBe('recharge');
  });

  it('falls back to "query" when empty', () => {
    expect(summarizeShapeMembers(shape())).toBe('query');
  });
});

describe('groupFeatures', () => {
  const registry = { featureKeys: ['chats', 'segments', 'advisor', 'admin'] } as unknown as AdminRegistry;
  const mkUser = (features: Record<string, boolean> = {}): AdminUser =>
    ({ email: 'u@corp.com', status: 'active', features } as unknown as AdminUser);

  const restricted = (g: ReturnType<typeof groupFeatures>) =>
    g.find((x) => x.defaultOn === false)!;

  it('groups advisor + admin as restricted (default off), resolving off without a grant', () => {
    const r = restricted(groupFeatures(registry, mkUser()));
    expect(r.entries.map((e) => e.key).sort()).toEqual(['admin', 'advisor']);
    expect(r.entries.every((e) => e.active === false)).toBe(true);
  });

  it('an explicit grant turns advisor on and marks it an override', () => {
    const r = restricted(groupFeatures(registry, mkUser({ advisor: true })));
    const adv = r.entries.find((e) => e.key === 'advisor')!;
    expect(adv.active).toBe(true);
    expect(adv.override).toBe(true);
  });

  it('keeps analyst surfaces default-on', () => {
    const g = groupFeatures(registry, mkUser());
    const analyst = g.find((x) => x.defaultOn === true)!;
    expect(analyst.entries.find((e) => e.key === 'segments')?.active).toBe(true);
  });
});

describe('buildShapePlaygroundUrl', () => {
  it('encodes measures and dimensions into a /build?query= URL', () => {
    const url = buildShapePlaygroundUrl(shape({
      cubes: ['recharge'], measures: ['recharge.revenue_vnd'], dimensions: ['recharge.user_id'],
    }))!;
    expect(url).toMatch(/^\/build\?query=/);
    const query = JSON.parse(decodeURIComponent(url.split('?query=')[1]));
    expect(query).toEqual({ measures: ['recharge.revenue_vnd'], dimensions: ['recharge.user_id'] });
  });

  it('omits an empty members array rather than sending []', () => {
    const url = buildShapePlaygroundUrl(shape({ measures: ['recharge.revenue_vnd'] }))!;
    const query = JSON.parse(decodeURIComponent(url.split('?query=')[1]));
    expect(query).toEqual({ measures: ['recharge.revenue_vnd'] });
    expect('dimensions' in query).toBe(false);
  });

  it('returns null when there is nothing selectable', () => {
    expect(buildShapePlaygroundUrl(shape({ cubes: ['recharge'] }))).toBeNull();
    expect(buildShapePlaygroundUrl(shape())).toBeNull();
  });
});
