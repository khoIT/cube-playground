/**
 * Loads + validates starter dashboard YAML files at boot.
 *
 * Each file under `server/src/presets/dashboard-starter-pack/*.yml` describes
 * one starter dashboard (slug + tiles). The loader Zod-validates and caches
 * the result; malformed files are logged and skipped (mirrors the
 * business-metrics-loader pattern — never block the server boot).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = resolve(__dirname, '../presets/dashboard-starter-pack');

const tilePositionSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});

const tileQuerySchema = z.object({
  measures: z.array(z.string()).optional(),
  dimensions: z.array(z.string()).optional(),
  timeDimensions: z.array(z.unknown()).optional(),
  filters: z.array(z.unknown()).optional(),
  order: z.unknown().optional(),
  limit: z.number().int().positive().optional(),
  compare: z.union([z.literal('prev'), z.literal(null), z.string()]).nullable().optional(),
}).passthrough();

const tileSchema = z.object({
  title: z.string().min(1).max(256),
  viz_type: z.enum(['kpi', 'line', 'bar', 'table']),
  position: tilePositionSchema,
  query: tileQuerySchema,
});

const dashboardSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).min(1).max(128),
  title: z.string().min(1).max(256),
  description: z.string().optional(),
  applies_when: z.object({
    required_cubes: z.array(z.string()).default([]),
  }).default({ required_cubes: [] }),
  tiles: z.array(tileSchema).min(1).max(8),
});

export type StarterDashboard = z.infer<typeof dashboardSchema>;

let cache: StarterDashboard[] | null = null;
let registryDir = DEFAULT_DIR;

export function setStarterPackDir(dir: string): void {
  registryDir = dir;
  cache = null;
}

export function loadStarterPack(opts: { warn?: (msg: string) => void } = {}): StarterDashboard[] {
  if (cache) return cache;
  const dashboards: StarterDashboard[] = [];
  let files: string[];
  try {
    files = readdirSync(registryDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  } catch (err) {
    opts.warn?.(`[starter-pack] registry not found at ${registryDir}: ${(err as Error).message}`);
    cache = [];
    return cache;
  }
  for (const file of files) {
    try {
      const raw = readFileSync(join(registryDir, file), 'utf8');
      const parsed = yaml.load(raw);
      const validated = dashboardSchema.parse(parsed);
      dashboards.push(validated);
    } catch (err) {
      opts.warn?.(`[starter-pack] skipped ${file}: ${(err as Error).message}`);
    }
  }
  cache = dashboards;
  return cache;
}

export function __resetStarterPackCache(): void {
  cache = null;
}
