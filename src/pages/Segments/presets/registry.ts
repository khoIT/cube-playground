/** Preset id → Preset. v1 ships a single bundle for mf_users-hub. */

import type { Preset } from './types';
import { mfUsersHubPreset } from './mf-users-hub';

const PRESETS: Record<string, Preset> = {
  [mfUsersHubPreset.id]: mfUsersHubPreset,
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
