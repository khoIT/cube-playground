/**
 * recharge-events preset, loaded from the shared YAML bundle
 * (server/src/presets/bundles/recharge-events.yml — inlined at build time).
 * Field-availability notes live in the bundle header.
 */

import rawBundle from '../../../../server/src/presets/bundles/recharge-events.yml?raw';
import { parsePresetBundle } from './parse-preset-bundle';

export const rechargeEventsPreset = parsePresetBundle(rawBundle);
