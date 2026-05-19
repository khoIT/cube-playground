/** Resolves a segment's preset_id (or hubCube fallback) to a Preset object. */

import { useMemo } from 'react';
import { getPreset, getPresetByHubCube } from '../presets/registry';
import type { Segment } from '../../../types/segment-api';
import type { Preset } from '../presets/types';

export function usePreset(segment: Segment | null): Preset | null {
  return useMemo(() => {
    if (!segment) return null;
    // v1 stores preset_id in cube_query_json metadata or falls back to hubCube match.
    const direct = getPreset((segment as Segment & { preset_id?: string }).preset_id ?? null);
    if (direct) return direct;
    return getPresetByHubCube(segment.cube);
  }, [segment]);
}
