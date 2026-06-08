import { describe, it, expect } from 'vitest';
import { mutationTargetFor } from '../playbook-mutation-target';

/**
 * Regression guard for the override id-routing bug: a resolved override carries
 * `id` = its seed base-id ('04') but must be PATCHed by `overrideId` (the DB row
 * uuid). Routing by `id` 404s server-side. Seeds POST a fresh override; custom
 * rows PATCH by their own row id (id === overrideId).
 */
describe('mutationTargetFor', () => {
  it('routes a seed → createFromSeed carrying the seed id as base_id', () => {
    expect(mutationTargetFor({ source: 'seed', id: '04' })).toEqual({
      kind: 'createFromSeed',
      baseId: '04',
    });
  });

  it('routes an override → PATCH by overrideId, NOT by the seed-base display id', () => {
    const t = mutationTargetFor({ source: 'override', id: '04', overrideId: 'row-uuid-1' });
    expect(t).toEqual({ kind: 'patch', overrideId: 'row-uuid-1' });
    // Guard the specific regression: must never PATCH the seed base-id.
    expect(t).not.toEqual({ kind: 'patch', overrideId: '04' });
  });

  it('routes a custom (net-new) row → PATCH by its own row id', () => {
    expect(
      mutationTargetFor({ source: 'custom', id: 'row-uuid-2', overrideId: 'row-uuid-2' }),
    ).toEqual({ kind: 'patch', overrideId: 'row-uuid-2' });
  });

  it('falls back to createNew for a non-seed row missing its overrideId (defensive)', () => {
    expect(mutationTargetFor({ source: 'custom', id: 'x' })).toEqual({ kind: 'createNew' });
  });
});
