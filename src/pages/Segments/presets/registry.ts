/** Preset id → Preset. Curated bundles per hub cube. */

import type { Preset } from './types';
import { mfUsersHubPreset } from './mf-users-hub';
import { rechargeEventsPreset } from './recharge-events';

const PRESETS: Record<string, Preset> = {
  [mfUsersHubPreset.id]: mfUsersHubPreset,
  [rechargeEventsPreset.id]: rechargeEventsPreset,
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
