import { describe, it, expect } from 'vitest';
import { mutationTargetFor, resolveSweepTargetId } from '../playbook-mutation-target';

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

/**
 * After a Save & sweep, the per-segment sweep must target the merged DISPLAY id,
 * not the created DB row id — these diverge for seeds/overrides. This guards the
 * resolution so a save+sweep can't sweep the wrong (or no) playbook.
 */
describe('resolveSweepTargetId', () => {
  it('patching an override → the source display id (seed id), not the row id', () => {
    const id = resolveSweepTargetId({
      mutation: { kind: 'patch', overrideId: 'row-uuid-1' },
      sourceDisplayId: '04',
      isClone: false,
      baseIdFromUrl: null,
    });
    expect(id).toBe('04');
  });

  it('patching a custom row → its own display id', () => {
    const id = resolveSweepTargetId({
      mutation: { kind: 'patch', overrideId: 'row-uuid-2' },
      sourceDisplayId: 'row-uuid-2',
      isClone: false,
      baseIdFromUrl: null,
    });
    expect(id).toBe('row-uuid-2');
  });

  it('saving a seed (createFromSeed) → the seed id, since an override resolves under it', () => {
    const id = resolveSweepTargetId({
      mutation: { kind: 'createFromSeed', baseId: '07' },
      isClone: false,
      baseIdFromUrl: null,
      createdRowId: 'row-uuid-3',
    });
    expect(id).toBe('07');
  });

  it('net-new custom playbook → the freshly created row id', () => {
    const id = resolveSweepTargetId({
      mutation: null,
      isClone: false,
      baseIdFromUrl: null,
      createdRowId: 'row-uuid-4',
    });
    expect(id).toBe('row-uuid-4');
  });

  it('cloning → the created row id (a clone is always net-new)', () => {
    const id = resolveSweepTargetId({
      mutation: null,
      isClone: true,
      baseIdFromUrl: '09', // a clone ignores the seed lineage for sweep targeting
      createdRowId: 'row-uuid-5',
    });
    expect(id).toBe('row-uuid-5');
  });

  it('new form opened from a seed base_id → that seed id (the override resolves under it)', () => {
    const id = resolveSweepTargetId({
      mutation: null,
      isClone: false,
      baseIdFromUrl: '12',
      createdRowId: 'row-uuid-6',
    });
    expect(id).toBe('12');
  });
});
