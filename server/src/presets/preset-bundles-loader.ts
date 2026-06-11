/**
 * Loads curated preset bundles from ./bundles/*.yml — the single source of
 * truth shared with the FE (which inlines the same files at build time via
 * Vite `?raw`). Replaces the hand-synced TS mirrors that drifted twice:
 * cache keys (`card:<tabId>:<cardId>`) and measure names are a cross-side
 * contract, and a YAML both sides parse makes drift impossible.
 *
 * Same __dirname-relative resolution as the business-metrics registry, so the
 * bundles ride along wherever server/src is shipped (host tsx, docker COPY).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import type { PresetSpec } from './mf-users-hub.js';

/** Bundles live in the SOURCE tree (tsc does not copy .yml into dist). When
 *  running compiled output (`node dist/index.js`), fall back from
 *  `dist/presets/bundles` to the sibling `src/presets/bundles` — the Docker
 *  image ships the whole server/ tree, so src is always present. */
function resolveBundlesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const local = join(here, 'bundles');
  if (existsSync(local)) return local;
  const fromDist = local.replace(`${sep}dist${sep}`, `${sep}src${sep}`);
  if (existsSync(fromDist)) return fromDist;
  return local; // let the read fail with the primary path in the error
}

const BUNDLES_DIR = resolveBundlesDir();

/** Parse + minimally validate one bundle. Throws at module load (boot) on a
 *  malformed file — a broken preset must fail loudly, not precompute nothing. */
export function loadPresetBundle(name: string): PresetSpec {
  const path = join(BUNDLES_DIR, `${name}.yml`);
  const doc = yaml.load(readFileSync(path, 'utf8')) as Partial<PresetSpec> | null;
  if (!doc || typeof doc !== 'object') {
    throw new Error(`[preset-bundles] ${path} did not parse to an object`);
  }
  for (const field of ['id', 'hubCube', 'identityDim', 'headlineKpis', 'tabs'] as const) {
    if (doc[field] == null) {
      throw new Error(`[preset-bundles] ${path} missing required field '${field}'`);
    }
  }
  for (const tab of doc.tabs!) {
    if (!tab.id || !Array.isArray(tab.kpis) || !Array.isArray(tab.cards)) {
      throw new Error(`[preset-bundles] ${path} tab '${tab.id ?? '?'}' malformed (needs id, kpis[], cards[])`);
    }
  }
  return doc as PresetSpec;
}
