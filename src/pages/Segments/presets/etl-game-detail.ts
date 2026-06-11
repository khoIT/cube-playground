/**
 * etl_game_detail-hub preset, loaded from the shared YAML bundle
 * (server/src/presets/bundles/etl-game-detail.yml — inlined at build time).
 * Mixed-grain design notes live in the bundle header.
 */

import rawBundle from '../../../../server/src/presets/bundles/etl-game-detail.yml?raw';
import { parsePresetBundle } from './parse-preset-bundle';

export const etlGameDetailPreset = parsePresetBundle(rawBundle);
