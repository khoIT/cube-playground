/**
 * Server-side preset registry — mirror of src/pages/Segments/presets/registry.ts.
 * Owns preset lookup for the refresh job's card pre-rendering. Lookup logic
 * (direct hub-cube match, then identity-anchor pivot) lives here so it stays
 * unit-testable without spinning the refresh job.
 */

import type { PresetSpec } from './mf-users-hub.js';
import { mfUsersHubPreset } from './mf-users-hub.js';
import { etlGameDetailPreset } from './etl-game-detail.js';

export const presetRegistry: Record<string, PresetSpec> = {
  [mfUsersHubPreset.id]: mfUsersHubPreset,
  [etlGameDetailPreset.id]: etlGameDetailPreset,
};

/** Pick the preset for a segment by its hub cube (logical name). */
export function pickPresetForCube(cube: string | null): PresetSpec | null {
  if (!cube) return null;
  for (const p of Object.values(presetRegistry)) {
    if (p.hubCube === cube) return p;
  }
  return null;
}

/**
 * Preset for a segment: direct hub-cube match wins; otherwise pivot to the
 * IDENTITY ANCHOR cube's preset. A segment on a cube with no curated preset
 * but a join-inherited identity (e.g. `etl_money_flow` → `mf_users.user_id`)
 * reuses the anchor's user-centric preset — every card query is scoped by the
 * segment's own predicate filters and joins back through the same path that
 * proved the identity inheritance, so the cards describe the users behind the
 * segment's events. Both names must be LOGICAL (prefix-stripped).
 */
export function pickPresetForSegment(
  segmentCube: string | null,
  anchorCube: string | null,
): PresetSpec | null {
  const direct = pickPresetForCube(segmentCube);
  if (direct) return direct;
  if (anchorCube && anchorCube !== segmentCube) return pickPresetForCube(anchorCube);
  return null;
}
