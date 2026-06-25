import { describe, it, expect } from 'vitest';
import { buildAtlasGraph } from '../build-atlas-graph';
import type { AtlasFeature, AtlasModel, FeatureHealth } from '../atlas-types';

function feat(id: string, surfaceId: string, health: FeatureHealth, deps: string[] = []): AtlasFeature {
  return {
    id, label: id, surfaceId, surfaceLabel: surfaceId, status: 'shipped', health,
    summary: '', drawbacks: [], directions: [], deps, links: { plans: [], code: [], memory: [] }, lastTouched: null,
  };
}

function model(features: AtlasFeature[]): AtlasModel {
  const bySurface = new Map<string, AtlasFeature[]>();
  for (const f of features) {
    const list = bySurface.get(f.surfaceId) ?? [];
    list.push(f);
    bySurface.set(f.surfaceId, list);
  }
  const surfaces = [...bySurface.entries()].map(([id, fs]) => ({ id, label: id, features: fs }));
  const featById = new Map(features.map((f) => [f.id, f]));
  const dependedOnBy = new Map<string, string[]>();
  for (const f of features) for (const d of f.deps) dependedOnBy.set(d, [...(dependedOnBy.get(d) ?? []), f.id]);
  return { version: 1, reconciledAt: '2026-06-25', surfaces, featById, dependedOnBy };
}

describe('buildAtlasGraph', () => {
  it('emits one surface node + one node per feature', () => {
    const m = model([feat('a', 's1', 'healthy'), feat('b', 's1', 'partial'), feat('c', 's2', 'at-risk')]);
    const g = buildAtlasGraph(m);
    expect(g.nodes.filter((n) => n.kind === 'surface')).toHaveLength(2);
    expect(g.nodes.filter((n) => n.kind === 'feature')).toHaveLength(3);
    expect(g.nodes.find((n) => n.id === 'feature:a')?.feature?.id).toBe('a');
  });

  it('draws a dep edge only when both endpoints are modeled', () => {
    const m = model([feat('a', 's1', 'healthy', ['b', 'ghost']), feat('b', 's1', 'healthy')]);
    const g = buildAtlasGraph(m);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ source: 'feature:a', target: 'feature:b' });
  });

  it('is deterministic — same model yields identical coordinates', () => {
    const build = () => buildAtlasGraph(model([feat('a', 's1', 'healthy'), feat('b', 's2', 'partial')]));
    expect(build().nodes).toEqual(build().nodes);
  });

  it('spills dense surfaces onto multiple rings at increasing radius', () => {
    const many = Array.from({ length: 20 }, (_, i) => feat(`f${i}`, 's1', 'healthy'));
    const g = buildAtlasGraph(model(many));
    const root = g.nodes.find((n) => n.kind === 'surface')!;
    const radii = g.nodes
      .filter((n) => n.kind === 'feature')
      .map((n) => Math.round(Math.hypot(n.x - root.x, n.y - root.y)));
    // More than one distinct ring radius once the first ring (cap 7) overflows.
    expect(new Set(radii).size).toBeGreaterThan(1);
  });

  it('computes a bounding box spanning all nodes', () => {
    const g = buildAtlasGraph(model([feat('a', 's1', 'healthy'), feat('b', 's2', 'partial')]));
    const xs = g.nodes.map((n) => n.x);
    expect(g.bounds.minX).toBe(Math.min(...xs));
    expect(g.bounds.maxX).toBe(Math.max(...xs));
  });
});
