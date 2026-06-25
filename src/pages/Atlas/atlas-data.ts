/**
 * Feature Atlas — loader. Parses the committed YAML spine at build time and
 * shapes it into the typed model the views render. Pure (no React) so it is
 * unit-testable. The page is a PURE RENDERER: all state lives in atlas.yaml.
 *
 * Loading pipeline (mirrors the reconcile helper for consistency):
 *   atlas.yaml ?raw  →  js-yaml.load  →  normalizeAtlas (Date→ISO)  →
 *   validateAtlas (fail loudly)  →  shapeModel (hygiene + derived indexes)
 */
import yaml from 'js-yaml';
// .mjs validator is shared with scripts/atlas-reconcile.mjs (DRY). Plain-JS module
// (typed via src/feature-atlas/validate-atlas.d.ts).
import { validateAtlas, normalizeAtlas } from '../../feature-atlas/validate-atlas.mjs';
import rawAtlas from '../../feature-atlas/atlas.yaml?raw';
import type {
  AtlasDirection,
  AtlasFeature,
  AtlasLoadResult,
  AtlasModel,
  Effort,
  FeatureHealth,
  FeatureStatus,
} from './atlas-types';

const EFFORTS = new Set<Effort>(['S', 'M', 'L', 'XL']);

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Keep only {label, effort}; drop label-less entries; coerce bad effort to null. */
function shapeDirections(raw: unknown): AtlasDirection[] {
  return asArray(raw)
    .map((d): AtlasDirection | null => {
      if (!d || typeof d !== 'object') return null;
      const obj = d as Record<string, unknown>;
      const label = typeof obj.label === 'string' ? obj.label.trim() : '';
      if (!label) return null;
      const effort = EFFORTS.has(obj.effort as Effort) ? (obj.effort as Effort) : null;
      return { label, effort };
    })
    .filter((d): d is AtlasDirection => d !== null);
}

function shapeFeature(raw: Record<string, unknown>, surfaceId: string, surfaceLabel: string): AtlasFeature {
  const links = (raw.links ?? {}) as Record<string, unknown>;
  return {
    id: String(raw.id),
    label: String(raw.label ?? raw.id),
    surfaceId,
    surfaceLabel,
    status: raw.status as FeatureStatus,
    health: raw.health as FeatureHealth,
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    drawbacks: asArray(raw.drawbacks).map(String),
    directions: shapeDirections(raw.directions),
    deps: asArray(raw.deps).map(String),
    links: {
      plans: asArray(links.plans).map(String),
      code: asArray(links.code).map(String),
      memory: asArray(links.memory).map(String),
    },
    lastTouched: raw.lastTouched != null ? String(raw.lastTouched) : null,
  };
}

function shapeModel(atlas: Record<string, unknown>): AtlasModel {
  const surfaces = asArray(atlas.surfaces).map((s) => {
    const surf = s as Record<string, unknown>;
    const id = String(surf.id);
    const label = String(surf.label ?? id);
    const features = asArray(surf.features).map((f) => shapeFeature(f as Record<string, unknown>, id, label));
    return { id, label, features };
  });

  const featById = new Map<string, AtlasFeature>();
  for (const s of surfaces) for (const f of s.features) featById.set(f.id, f);

  // Reverse-dep index: for each dep edge a→b, record a under b's impact radius.
  const dependedOnBy = new Map<string, string[]>();
  for (const s of surfaces) {
    for (const f of s.features) {
      for (const dep of f.deps) {
        const list = dependedOnBy.get(dep) ?? [];
        list.push(f.id);
        dependedOnBy.set(dep, list);
      }
    }
  }

  return {
    version: Number(atlas.version),
    reconciledAt: String(atlas.reconciledAt),
    surfaces,
    featById,
    dependedOnBy,
  };
}

/** Load + validate + shape. Never throws — returns a result for the UI to render. */
export function loadAtlas(): AtlasLoadResult {
  try {
    const parsed = normalizeAtlas(yaml.load(rawAtlas)) as Record<string, unknown>;
    const { valid, errors } = validateAtlas(parsed) as { valid: boolean; errors: string[] };
    if (!valid) {
      return { ok: false, error: `atlas.yaml is invalid:\n${errors.map((e) => `• ${e}`).join('\n')}` };
    }
    return { ok: true, model: shapeModel(parsed) };
  } catch (err) {
    return { ok: false, error: `Failed to parse atlas.yaml: ${(err as Error).message}` };
  }
}
