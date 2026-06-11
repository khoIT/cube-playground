/**
 * Parses a shared preset bundle (server/src/presets/bundles/*.yml, inlined at
 * build time via Vite `?raw`) into the FE Preset shape. One YAML feeds both
 * the FE renderer and the server card-runner, so the cache keys
 * (`card:<tabId>:<cardId>`) and measures can never drift between them again.
 *
 * Throws on a malformed bundle — that surfaces at module load in dev/test
 * (build-time inlined string), never lazily in production UI paths.
 */

import { load } from 'js-yaml';
import type { Preset } from './types';

export function parsePresetBundle(raw: string): Preset {
  const doc = load(raw) as Preset | null;
  if (!doc || typeof doc !== 'object') {
    throw new Error('[presets] bundle did not parse to an object');
  }
  if (!doc.id || !doc.hubCube || !doc.identityDim || !Array.isArray(doc.headlineKpis) || !Array.isArray(doc.tabs)) {
    throw new Error(`[presets] bundle '${doc.id ?? '?'}' missing required fields`);
  }
  return doc;
}
