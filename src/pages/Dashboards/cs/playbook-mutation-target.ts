/**
 * Where a save / enable / disable for a resolved playbook must be routed.
 *
 * The merge layer gives every resolved playbook a display `id`, but that id is
 * NOT the mutation key:
 *   - seed              → `id` is the canonical seed id ('04'); has no DB row yet.
 *   - override (of seed) → `id` is STILL the seed id ('04'); the DB row is `overrideId`.
 *   - custom (net-new)   → `id` equals the DB row id, and `overrideId` is the same.
 *
 * PATCH/DELETE on the server key on the DB row id (`overrideId`), so mutating an
 * override by its display `id` 404s. Seeds have no row, so editing one POSTs a
 * new override carrying `base_id = seedId`. This helper is the single source of
 * truth for that routing, shared by the monitor grid and the builder.
 */

import type { PlaybookSource } from './use-care-playbooks';

export type PlaybookMutationTarget =
  | { kind: 'patch'; overrideId: string } // existing override OR custom row → PATCH by row id
  | { kind: 'createFromSeed'; baseId: string } // seed → POST a new override (base_id = seed id)
  | { kind: 'createNew' }; // net-new / clone → POST with base_id null

export function mutationTargetFor(pb: {
  source: PlaybookSource;
  id: string;
  overrideId?: string;
}): PlaybookMutationTarget {
  if (pb.source === 'seed') return { kind: 'createFromSeed', baseId: pb.id };
  // override or custom: both back onto a DB row addressed by overrideId.
  if (pb.overrideId) return { kind: 'patch', overrideId: pb.overrideId };
  // Defensive: a non-seed playbook with no row id shouldn't reach here, but if
  // it does, fall back to creating a net-new row rather than mis-PATCHing.
  return { kind: 'createNew' };
}

/**
 * The merged DISPLAY id a per-segment sweep must target after a save — NOT the
 * created DB row id. A sweep filters playbooks by their resolved display id:
 *   - patch (override/custom row): the source playbook's display id (a seed's id
 *     for an override; the row id for a custom playbook).
 *   - createFromSeed: the seed id — an override resolves under its seed's id.
 *   - net-new with a base_id (editing/cloning a seed via URL): that seed id.
 *   - net-new with no base_id: the freshly created row id.
 */
export function resolveSweepTargetId(input: {
  mutation: PlaybookMutationTarget | null; // null when creating (clone / new)
  sourceDisplayId?: string;
  isClone: boolean;
  baseIdFromUrl: string | null;
  createdRowId?: string;
}): string {
  const { mutation } = input;
  if (mutation?.kind === 'patch') return input.sourceDisplayId ?? input.createdRowId ?? '';
  if (mutation?.kind === 'createFromSeed') return mutation.baseId;
  // Creating: a clone is always net-new; a "new" form may carry a seed base_id.
  if (input.isClone) return input.createdRowId ?? '';
  return input.baseIdFromUrl ?? input.createdRowId ?? '';
}
