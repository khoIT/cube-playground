/**
 * Feature Atlas — pure graph-layout builder for the cluster-graph view.
 * Mirrors the pure-builder pattern of Catalog's build-join-graph.ts: no React,
 * deterministic, unit-testable. Lays out 6 surface clusters on a ring, with each
 * surface's features fanned out on concentric sub-rings (multi-ring so labels
 * don't collide for dense surfaces), and dep edges between features.
 */
import { HEALTH_PRIORITY } from './atlas-encoding';
import type { AtlasFeature, AtlasModel } from './atlas-types';

export interface AtlasGraphNode {
  id: string;
  kind: 'surface' | 'feature';
  x: number;
  y: number;
  label: string;
  feature?: AtlasFeature;
  surfaceId: string;
}

export interface AtlasGraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface AtlasGraph {
  nodes: AtlasGraphNode[];
  edges: AtlasGraphEdge[];
  /** Bounding box (min/max over node coords) for fit-to-viewport. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

interface LayoutOpts {
  surfaceRadius?: number; // distance of each surface cluster from origin
  ringBase?: number; // radius of a surface's first feature ring
  ringGap?: number; // gap between concentric feature rings
  firstRingCapacity?: number; // features on the innermost ring before spilling out
}

const DEFAULTS: Required<LayoutOpts> = {
  surfaceRadius: 520,
  ringBase: 130,
  ringGap: 95,
  firstRingCapacity: 7,
};

/** Capacity of ring r (0-indexed) grows so outer rings hold more features. */
function ringCapacity(r: number, first: number): number {
  return first + r * 6;
}

/** Assign each feature index to a (ring, slot) so rings fill inner→outer. */
function ringAssignment(count: number, first: number): Array<{ ring: number; slot: number; ringCount: number }> {
  const out: Array<{ ring: number; slot: number; ringCount: number }> = [];
  let i = 0;
  let ring = 0;
  while (i < count) {
    const cap = ringCapacity(ring, first);
    const remaining = count - i;
    const ringCount = Math.min(cap, remaining);
    for (let slot = 0; slot < ringCount; slot++) out.push({ ring, slot, ringCount });
    i += ringCount;
    ring++;
  }
  return out;
}

export function buildAtlasGraph(model: AtlasModel, opts: LayoutOpts = {}): AtlasGraph {
  const o = { ...DEFAULTS, ...opts };
  const nodes: AtlasGraphNode[] = [];
  const edges: AtlasGraphEdge[] = [];
  const surfaces = model.surfaces;
  const n = Math.max(surfaces.length, 1);

  surfaces.forEach((surface, si) => {
    const sAngle = (2 * Math.PI * si) / n - Math.PI / 2; // start at top
    const sx = Math.cos(sAngle) * o.surfaceRadius;
    const sy = Math.sin(sAngle) * o.surfaceRadius;
    nodes.push({ id: `surface:${surface.id}`, kind: 'surface', x: sx, y: sy, label: surface.label, surfaceId: surface.id });

    // Stable triage order: most-urgent health nearest the cluster root.
    const features = [...surface.features].sort((a, b) => HEALTH_PRIORITY[a.health] - HEALTH_PRIORITY[b.health]);
    const assign = ringAssignment(features.length, o.firstRingCapacity);

    features.forEach((f, fi) => {
      const { ring, slot, ringCount } = assign[fi];
      const radius = o.ringBase + ring * o.ringGap;
      // Spread this ring's features evenly over a full turn, offset per ring so
      // adjacent rings don't line up radially.
      const a = (2 * Math.PI * slot) / Math.max(ringCount, 1) + ring * 0.4;
      nodes.push({
        id: `feature:${f.id}`,
        kind: 'feature',
        x: sx + Math.cos(a) * radius,
        y: sy + Math.sin(a) * radius,
        label: f.label,
        feature: f,
        surfaceId: surface.id,
      });
    });
  });

  // Dep edges (feature→feature) — only when both endpoints are modeled.
  for (const surface of surfaces) {
    for (const f of surface.features) {
      for (const dep of f.deps) {
        if (model.featById.has(dep)) {
          edges.push({ id: `${f.id}->${dep}`, source: `feature:${f.id}`, target: `feature:${dep}` });
        }
      }
    }
  }

  const xs = nodes.map((nd) => nd.x);
  const ys = nodes.map((nd) => nd.y);
  const bounds = {
    minX: xs.length ? Math.min(...xs) : 0,
    minY: ys.length ? Math.min(...ys) : 0,
    maxX: xs.length ? Math.max(...xs) : 0,
    maxY: ys.length ? Math.max(...ys) : 0,
  };

  return { nodes, edges, bounds };
}
