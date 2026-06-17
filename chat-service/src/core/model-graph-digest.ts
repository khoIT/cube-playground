/**
 * Per-game model-graph digest for the agent system prompt.
 *
 * The agent's `get_cube_meta` is pull-based and degrades to a name index on
 * big games, so the model often never sees the join topology and triages
 * metrics by glossary term-matching alone. This module pushes a compact map —
 * the user hub + its key, what joins to it, the clusters, and the isolated
 * marts — so the agent knows "which cube holds this metric and what it can
 * join to" before it ever fetches /meta.
 *
 * Built from the SAME join graph the FE Catalog renders (the vendored
 * `build-join-graph`), reduced to ~prompt-sized text. Stable per game, so the
 * rendered block lands in the prompt-cached prefix → ~0 marginal cost per turn
 * within a game. Memoised on the meta-version hash and recomputed only when
 * the schema changes.
 */

import { buildJoinGraph, cubeBaseName, type JoinGraphInputCube } from '../shared/cube-model-graph/index.js';
import type { ModelGraphDigest, DigestHubEdge } from './agent-context-types.js';
import { getMeta, getMetaVersion } from './cube-meta-cache.js';

/** Meta cube shape this builder reads — join-graph subset plus PK dimensions. */
interface MetaCubeForDigest extends JoinGraphInputCube {
  dimensions?: Array<{ name: string; primaryKey?: boolean }>;
}

const HUB_SUFFIX = '_mf_users';

/**
 * Detect the workspace game prefix from the hub cube's name so the cluster
 * heuristics see the same base names on prefixed (`cfm_vn_mf_users`) and bare
 * (`mf_users`, game_id workspaces) layouts. Returns undefined for bare names.
 */
export function detectGamePrefix(cubeNames: string[]): string | undefined {
  for (const raw of cubeNames) {
    const n = raw.toLowerCase();
    if (n === 'mf_users') return undefined;
    if (n.endsWith(HUB_SUFFIX) && n.length > HUB_SUFFIX.length) {
      return raw.slice(0, raw.length - HUB_SUFFIX.length);
    }
  }
  return undefined;
}

/** Short member name: the segment after the last dot (`mf_users.user_id` → `user_id`). */
function shortMember(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1) : name;
}

/** Target column of a `local → target` key label, used to infer the hub PK. */
function targetColOf(keyLabel: string): string | undefined {
  const i = keyLabel.indexOf('→');
  if (i < 0) return undefined;
  return keyLabel.slice(i + 1).trim() || undefined;
}

/**
 * Most frequently referenced hub-side join column across inbound edges, ties
 * broken alphabetically — deterministic regardless of /meta cube order.
 */
function mostCommonTargetCol(edges: DigestHubEdge[]): string | undefined {
  const counts = new Map<string, number>();
  for (const e of edges) {
    const col = targetColOf(e.keyLabel);
    if (col) counts.set(col, (counts.get(col) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = -1;
  for (const [col, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== undefined && col < best)) {
      best = col;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Reduce a /meta cube list to a ModelGraphDigest. Pure — no I/O.
 * `cubes` is the agent-visible meta (views + raw std_ tables already stripped
 * by the meta cache).
 */
export function buildDigest(
  cubes: MetaCubeForDigest[],
  gamePrefix?: string | null,
): ModelGraphDigest {
  const prefix = gamePrefix ?? detectGamePrefix(cubes.map((c) => c.name));
  const graph = buildJoinGraph(cubes, prefix);

  const hubNode = graph.nodes.find((n) => n.cluster === 'hub') ?? null;

  // Hub primary key: prefer the cube's declared primaryKey dimension; fall back
  // to the hub-side column of an inbound join, then to 'user_id'.
  let hub: ModelGraphDigest['hub'] = null;
  const hubInbound: DigestHubEdge[] = [];
  if (hubNode) {
    const hubName = hubNode.name;
    const hubCube = cubes.find((c) => c.name === hubName);
    const pkDim = hubCube?.dimensions?.find((d) => d.primaryKey);

    for (const e of graph.edges) {
      if (e.missingTarget) continue;
      const touchesHub = e.source === hubName || e.target === hubName;
      if (!touchesHub) continue;
      const other = e.source === hubName ? e.target : e.source;
      if (other === hubName) continue; // ignore self-joins
      hubInbound.push({ cube: cubeBaseName(other, prefix), keyLabel: e.keyLabel });
    }

    // PK: prefer the declared primaryKey dimension; else the most common
    // hub-side join column across inbound edges (order-independent — /meta
    // cube order must not change the result); else 'user_id'.
    const pk =
      (pkDim && shortMember(pkDim.name)) ||
      mostCommonTargetCol(hubInbound) ||
      'user_id';
    hub = { cube: cubeBaseName(hubName, prefix), pk };
  }

  // Clusters: base names grouped by cluster key, hub excluded (named separately).
  const clusters: Record<string, string[]> = {};
  for (const n of graph.nodes) {
    if (n.cluster === 'hub') continue;
    (clusters[n.cluster] ??= []).push(cubeBaseName(n.name, prefix));
  }
  for (const key of Object.keys(clusters)) clusters[key].sort();

  return {
    hub,
    hubInbound: dedupeByCube(hubInbound).sort((a, b) => a.cube.localeCompare(b.cube)),
    clusters,
    isolated: graph.lints.isolated.map((n) => cubeBaseName(n, prefix)).sort(),
    cubeCount: graph.nodes.length,
  };
}

function dedupeByCube(edges: DigestHubEdge[]): DigestHubEdge[] {
  const seen = new Set<string>();
  const out: DigestHubEdge[] = [];
  for (const e of edges) {
    if (seen.has(e.cube)) continue;
    seen.add(e.cube);
    out.push(e);
  }
  return out;
}

// Caps keep the injected block small on member-rich games (< ~400 tokens).
const MAX_HUB_INBOUND = 16;
const MAX_CLUSTER_MEMBERS = 8;
const MAX_ISOLATED = 14;

function capList(items: string[], max: number): string {
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')}, +${items.length - max} more`;
}

/**
 * Render a digest to a terse text block for the system prompt. Returns '' when
 * there is no hub and nothing useful to say (avoids injecting an empty header).
 * `gameLabel` is the active game code, shown in the header for orientation.
 */
export function renderDigest(digest: ModelGraphDigest, gameLabel?: string): string {
  if (!digest.hub && digest.hubInbound.length === 0 && Object.keys(digest.clusters).length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push(`## Data model${gameLabel ? ` (${gameLabel})` : ''}`);
  lines.push('');
  lines.push(
    'Use this map to pick the right cube and join path before fetching /meta. ' +
      'Per-entity facts hang off the user hub; join other cubes to it on the hub key.',
  );

  if (digest.hub) {
    const inbound = digest.hubInbound.map((e) => e.cube);
    lines.push('');
    lines.push(`Hub: ${digest.hub.cube} (pk ${digest.hub.pk}).`);
    if (inbound.length > 0) {
      lines.push(`Joins to the hub (N:1 on ${digest.hub.pk}): ${capList(inbound, MAX_HUB_INBOUND)}.`);
    }
  }

  const clusterKeys = Object.keys(digest.clusters).sort();
  if (clusterKeys.length > 0) {
    const rendered = clusterKeys
      .map((k) => `${k} {${capList(digest.clusters[k], MAX_CLUSTER_MEMBERS)}}`)
      .join('; ');
    lines.push(`Clusters: ${rendered}.`);
  }

  if (digest.isolated.length > 0) {
    lines.push(`Isolated (no join to the user — query standalone): ${capList(digest.isolated, MAX_ISOLATED)}.`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Memoised resolver for the turn path. Keyed by meta-version so it recomputes
// only when the schema changes; never throws into the turn (returns '' on error).
// ---------------------------------------------------------------------------

const renderedCache = new Map<string, string>();

/**
 * Resolve the rendered digest text for the active game+workspace. Memoised on
 * the meta-version hash so a stable schema is computed once and the cached
 * string is reused (the turn path injects it into the prompt-cached prefix).
 * Returns '' on any failure — the digest is an optional aid, never a blocker.
 */
export async function getModelDigestText(gameId: string, workspace: string): Promise<string> {
  try {
    const version = await getMetaVersion(gameId, workspace);
    const cacheKey = `${workspace}#${gameId}#${version}`;
    const cached = renderedCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const meta = await getMeta(gameId, workspace);
    const cubes: MetaCubeForDigest[] = Array.isArray(meta?.cubes) ? meta.cubes : [];
    const text = renderDigest(buildDigest(cubes), gameId);
    renderedCache.set(cacheKey, text);
    return text;
  } catch {
    return '';
  }
}

/** Test-only: clear the rendered-text memo. */
export function __resetDigestCache(): void {
  renderedCache.clear();
}
