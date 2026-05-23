/**
 * Business-metrics registry loader.
 *
 * Reads every `*.yml` in the registry directory, Zod-validates, caches in memory.
 * Malformed files are logged and skipped — they do not block the rest of the
 * registry. Writes are atomic (write to `.tmp`, then rename) so a crashed POST
 * can never leave a half-written `.yml` on disk.
 *
 * In dev mode (`NODE_ENV !== 'production'`) the loader watches the directory
 * via `fs.watch` and reloads when files change.
 */

import { mkdir, readdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import {
  BusinessMetric,
  BusinessMetricSchema,
} from '../types/business-metric.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY_DIR = resolve(__dirname, '../presets/business-metrics');

let registryDir = DEFAULT_REGISTRY_DIR;
const cache: Map<string, BusinessMetric> = new Map();
let watcher: FSWatcher | null = null;
let reloadTimer: NodeJS.Timeout | null = null;

export function setRegistryDir(dir: string): void {
  registryDir = dir;
}

export function getRegistryDir(): string {
  return registryDir;
}

export async function loadAll(
  logger: { warn: (...args: unknown[]) => void } = console,
): Promise<{ loaded: number; skipped: Array<{ file: string; reason: string }> }> {
  cache.clear();
  await mkdir(registryDir, { recursive: true });

  const files = (await readdir(registryDir)).filter((f) => f.endsWith('.yml'));
  const skipped: Array<{ file: string; reason: string }> = [];

  for (const file of files) {
    const path = join(registryDir, file);
    try {
      const raw = await readFile(path, 'utf8');
      const doc = yaml.load(raw);
      const parsed = BusinessMetricSchema.parse(doc);
      if (cache.has(parsed.id)) {
        const reason = `duplicate id "${parsed.id}" (already loaded)`;
        logger.warn(`[business-metrics] ${file}: ${reason}`);
        skipped.push({ file, reason });
        continue;
      }
      cache.set(parsed.id, parsed);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(`[business-metrics] ${file}: ${reason}`);
      skipped.push({ file, reason });
    }
  }

  return { loaded: cache.size, skipped };
}

export function getAll(): BusinessMetric[] {
  return [...cache.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function getById(id: string): BusinessMetric | undefined {
  return cache.get(id);
}

/**
 * Atomic write: serialise, write to `<id>.yml.tmp`, fsync via rename, then
 * update the in-memory cache. If anything fails before rename, the tmp file
 * is removed. Caller is responsible for Zod-validating the input.
 */
export async function writeMetric(metric: BusinessMetric): Promise<void> {
  await mkdir(registryDir, { recursive: true });
  const finalPath = join(registryDir, `${metric.id}.yml`);
  const tmpPath = `${finalPath}.tmp`;
  const serialised = yaml.dump(metric, { lineWidth: 100, noRefs: true });
  try {
    await writeFile(tmpPath, serialised, 'utf8');
    await rename(tmpPath, finalPath);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      // ignore — tmp may not exist
    }
    throw err;
  }
  cache.set(metric.id, metric);
}

export function startWatcher(
  onReload?: (info: { loaded: number; skipped: number }) => void,
): void {
  if (watcher) return;
  try {
    watcher = watch(registryDir, { persistent: false }, (_event, filename) => {
      if (!filename || !filename.endsWith('.yml')) return;
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        const result = await loadAll();
        onReload?.({ loaded: result.loaded, skipped: result.skipped.length });
      }, 100);
    });
  } catch (err) {
    console.warn('[business-metrics] watcher failed:', err);
  }
}

export function stopWatcher(): void {
  if (reloadTimer) {
    clearTimeout(reloadTimer);
    reloadTimer = null;
  }
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

/** Test-only: clear the in-memory cache without touching disk. */
export function clearCache(): void {
  cache.clear();
}
