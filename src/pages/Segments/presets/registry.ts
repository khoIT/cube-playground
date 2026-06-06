/** Preset id → Preset. Curated bundles per hub cube. */

import type { Preset } from './types';
import { mfUsersHubPreset } from './mf-users-hub';
import { rechargeEventsPreset } from './recharge-events';
import { etlGameDetailPreset } from './etl-game-detail';

const PRESETS: Record<string, Preset> = {
  [mfUsersHubPreset.id]: mfUsersHubPreset,
  [rechargeEventsPreset.id]: rechargeEventsPreset,
  [etlGameDetailPreset.id]: etlGameDetailPreset,
};

export function getPreset(id: string | null | undefined): Preset | null {
  if (!id) return null;
  return PRESETS[id] ?? null;
}

export function getPresetByHubCube(cube: string | null | undefined): Preset | null {
  if (!cube) return null;
  for (const p of Object.values(PRESETS)) {
    if (p.hubCube === cube) return p;
  }
  return null;
}

export function listPresets(): Preset[] {
  return Object.values(PRESETS);
}

/**
 * Identity-anchor pivot: when a segment's cube has no curated preset but its
 * identity field is join-inherited from a cube that HAS one (e.g.
 * `etl_money_flow` → `mf_users.user_id`), reuse the anchor's user-centric
 * preset. Card queries stay scoped by the segment's own predicate filters and
 * join back through the same path that proved the identity inheritance.
 * Returns a clone flagged with `pivotedFromCube` so the UI can explain it.
 */
export function resolvePivotPreset(
  segmentCube: string | null | undefined,
  identityField: string | null,
): Preset | null {
  if (!segmentCube || !identityField || !identityField.includes('.')) return null;
  const anchorCube = identityField.split('.')[0];
  if (anchorCube === segmentCube) return null;
  const anchor = getPresetByHubCube(anchorCube);
  if (!anchor) return null;
  return { ...anchor, pivotedFromCube: segmentCube };
}
