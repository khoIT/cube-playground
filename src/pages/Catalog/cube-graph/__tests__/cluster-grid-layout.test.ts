import { describe, expect, it } from 'vitest';
import type { JoinGraphNode } from '../build-join-graph';
import { clusterGridLayout, NODE_H, NODE_W } from '../cluster-grid-layout';

function node(name: string, cluster: string): JoinGraphNode {
  return { name, title: name, description: '', cluster, isolated: false };
}

const CFM_NODES: JoinGraphNode[] = [
  node('mf_users', 'hub'),
  node('user_roles', 'bridge'),
  node('etl_login', 'session'),
  node('etl_logout', 'session'),
  node('etl_game_detail', 'behavior'),
  node('etl_prop_flow', 'behavior'),
  node('user_recharge_daily', 'recharge'),
  node('active_performance_daily', 'activity'),
  node('device_map', 'mapping'),
  node('map_provider_master', 'profile'),
  node('game_key_metrics', 'other'),
];

describe('clusterGridLayout', () => {
  it('positions every node and emits one rect per cluster', () => {
    const { positions, clusterRects } = clusterGridLayout(CFM_NODES);
    expect(Object.keys(positions)).toHaveLength(CFM_NODES.length);
    expect(clusterRects.map((r) => r.cluster).sort()).toEqual(
      [...new Set(CFM_NODES.map((n) => n.cluster))].sort(),
    );
  });

  it('is deterministic for the same input', () => {
    expect(clusterGridLayout(CFM_NODES)).toEqual(clusterGridLayout(CFM_NODES));
  });

  it('contains each node inside its cluster rect', () => {
    const { positions, clusterRects } = clusterGridLayout(CFM_NODES);
    const rects = Object.fromEntries(clusterRects.map((r) => [r.cluster, r]));
    for (const n of CFM_NODES) {
      const p = positions[n.name];
      const r = rects[n.cluster];
      expect(p.x).toBeGreaterThanOrEqual(r.x);
      expect(p.y).toBeGreaterThanOrEqual(r.y);
      expect(p.x + NODE_W).toBeLessThanOrEqual(r.x + r.width);
      expect(p.y + NODE_H).toBeLessThanOrEqual(r.y + r.height);
    }
  });

  it('never overlaps cluster rects, even when hub and profile coexist', () => {
    const { clusterRects } = clusterGridLayout(CFM_NODES);
    for (let i = 0; i < clusterRects.length; i++) {
      for (let j = i + 1; j < clusterRects.length; j++) {
        const a = clusterRects[i];
        const b = clusterRects[j];
        const overlap =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(overlap, `${a.cluster} overlaps ${b.cluster}`).toBe(false);
      }
    }
  });

  it('uses profile as the hub stand-in when mf_users is absent', () => {
    const nodes = [node('user_master', 'profile'), node('etl_x', 'behavior')];
    const { clusterRects } = clusterGridLayout(nodes);
    const profile = clusterRects.find((r) => r.cluster === 'profile');
    const behavior = clusterRects.find((r) => r.cluster === 'behavior');
    // profile at anchor col 1, behavior at col 2 — profile sits to its left.
    expect(profile && behavior && profile.x < behavior.x).toBe(true);
  });

  it('packs multi-node clusters into a near-square grid', () => {
    const nodes = Array.from({ length: 4 }, (_, i) => node(`etl_${i}`, 'behavior'));
    const { positions } = clusterGridLayout(nodes);
    const xs = new Set(Object.values(positions).map((p) => p.x));
    const ys = new Set(Object.values(positions).map((p) => p.y));
    expect(xs.size).toBe(2); // 2×2 grid
    expect(ys.size).toBe(2);
  });

  it('handles unknown clusters by anchoring at the origin cell', () => {
    const { positions } = clusterGridLayout([node('mystery', 'uncharted')]);
    expect(positions.mystery).toEqual({ x: 0, y: 0 });
  });
});
