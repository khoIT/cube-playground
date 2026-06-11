/**
 * mf_users-hub preset, loaded from the shared YAML bundle
 * (server/src/presets/bundles/mf-users-hub.yml — inlined at build time).
 * The server card-runner consumes the SAME file, so the cache keys and
 * measures this renderer hydrates by can never drift from what the refresh
 * job precomputes. Design notes live in the bundle header.
 */

import rawBundle from '../../../../server/src/presets/bundles/mf-users-hub.yml?raw';
import { parsePresetBundle } from './parse-preset-bundle';

export const mfUsersHubPreset = parsePresetBundle(rawBundle);
