/**
 * etl_game_detail-hub preset, loaded from the shared YAML bundle
 * (./bundles/etl-game-detail.yml) — single source of truth with the FE.
 * See the bundle header for the mixed-grain design notes.
 */

import { loadPresetBundle } from './preset-bundles-loader.js';
import type { PresetSpec } from './mf-users-hub.js';

export const etlGameDetailPreset: PresetSpec = loadPresetBundle('etl-game-detail');
