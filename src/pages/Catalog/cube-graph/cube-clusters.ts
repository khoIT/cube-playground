/**
 * Single source of truth for the join-graph cluster vocabulary: the friendly
 * label and accent token for each topology cluster. Shared by the cube cards,
 * the cluster boxes, the legend, and the edge colors so the "color grouping"
 * reads identically everywhere (DRY).
 *
 * Accents reference the dedicated `--cluster-*` categorical palette in
 * tokens.css (light + dark pairs) — a purpose-built 9-hue scale so the clusters
 * stay mutually distinguishable, unlike the semantic/layer tokens which
 * collapse into too few hue families. Labels mirror the standalone
 * model-viewer legend.
 */

export interface ClusterMeta {
  label: string;
  accent: string;
}

/** Cluster keys produced by `clusterOf` in build-join-graph.ts. */
export const CLUSTER_META: Record<string, ClusterMeta> = {
  hub: { label: 'User hub', accent: 'var(--cluster-hub)' },
  bridge: { label: 'Role bridge', accent: 'var(--cluster-bridge)' },
  session: { label: 'Session events (direct join)', accent: 'var(--cluster-session)' },
  behavior: { label: 'Behavior-log events (bridge join)', accent: 'var(--cluster-behavior)' },
  recharge: { label: 'Recharge / monetization', accent: 'var(--cluster-recharge)' },
  activity: { label: 'Activity snapshots', accent: 'var(--cluster-activity)' },
  mapping: { label: 'Identity mapping', accent: 'var(--cluster-mapping)' },
  profile: { label: 'Profile / dimension', accent: 'var(--cluster-profile)' },
  other: { label: 'Other', accent: 'var(--cluster-other)' },
};

/** Legend / iteration order — hub first (the anchor), other last (catch-all). */
export const CLUSTER_ORDER: readonly string[] = [
  'hub',
  'bridge',
  'session',
  'behavior',
  'recharge',
  'activity',
  'mapping',
  'profile',
  'other',
];

const FALLBACK: ClusterMeta = CLUSTER_META.other;

export function clusterMeta(cluster: string): ClusterMeta {
  return CLUSTER_META[cluster] ?? FALLBACK;
}

export function clusterAccent(cluster: string): string {
  return clusterMeta(cluster).accent;
}

export function clusterLabel(cluster: string): string {
  return clusterMeta(cluster).label;
}
