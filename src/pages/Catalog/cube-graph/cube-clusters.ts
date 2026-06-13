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
  /** Full, descriptive label — used on the cluster box and as legend tooltip. */
  label: string;
  /** Compact label for the legend strip so it never wraps into an unreadable run. */
  short: string;
  accent: string;
}

/** Cluster keys produced by `clusterOf` in build-join-graph.ts. */
export const CLUSTER_META: Record<string, ClusterMeta> = {
  hub: { label: 'User hub', short: 'User hub', accent: 'var(--cluster-hub)' },
  bridge: { label: 'Role bridge', short: 'Role bridge', accent: 'var(--cluster-bridge)' },
  session: {
    label: 'Session events (direct join)',
    short: 'Session',
    accent: 'var(--cluster-session)',
  },
  behavior: {
    label: 'Behavior-log events (bridge join)',
    short: 'Behavior',
    accent: 'var(--cluster-behavior)',
  },
  recharge: { label: 'Recharge / monetization', short: 'Recharge', accent: 'var(--cluster-recharge)' },
  activity: { label: 'Activity snapshots', short: 'Activity', accent: 'var(--cluster-activity)' },
  mapping: { label: 'Identity mapping', short: 'Identity', accent: 'var(--cluster-mapping)' },
  profile: { label: 'Profile / dimension', short: 'Profile', accent: 'var(--cluster-profile)' },
  other: { label: 'Other', short: 'Other', accent: 'var(--cluster-other)' },
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

export function clusterShortLabel(cluster: string): string {
  return clusterMeta(cluster).short;
}
