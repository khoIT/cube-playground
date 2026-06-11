/**
 * Assembles the structured, business-language context the AI segment brief is
 * generated from. Three layers, cheapest first:
 *
 *   1. Segment meta — name, game, type, member count, and the predicate
 *      summarized to plain conditions (dimension word + operator words +
 *      values; cube prefixes stripped so no Cube member names leak).
 *   2. Enrichment — reuse fresh `segment_card_cache` rows (headline KPIs +
 *      composition distributions) written by the refresh job: ZERO new Cube
 *      queries when the card cache is <36h old. Absent/stale on a predicate
 *      segment → run just the headline KPIs + first two composition cards
 *      inline. Still nothing → `data_coverage='limited'` (predicate-only).
 *   3. Tier stats — median LTV of the stored top/bottom tiers when present.
 */

import { getCardCache } from './card-cache-store.js';
import { runPresetCards } from './card-runner.js';
import { pickPresetForSegment } from '../presets/registry.js';
import { resolveGamePrefixForWorkspace } from './resolve-game-prefix.js';
import { resolveCubeTokenForGame } from './resolve-cube-token.js';
import { logicalCube } from './cube-member-resolver.js';
import { getDb } from '../db/sqlite.js';
import { DISTRIBUTION_CARD_KINDS } from '../presets/mf-users-hub.js';
import type {
  PresetSpec,
  CardSpec,
  CompositionCardSpec,
  DonutCardSpec,
  SegmentedBarCardSpec,
} from '../presets/mf-users-hub.js';
import type { PredicateNode } from '../types/predicate-tree.js';

/** Categorical count-by-group cards — same query shape, different FE rendering. */
type DistributionCardSpec = CompositionCardSpec | DonutCardSpec | SegmentedBarCardSpec;

function isDistributionCard(card: CardSpec): card is DistributionCardSpec {
  return (DISTRIBUTION_CARD_KINDS as readonly string[]).includes(card.kind);
}

const CARD_CACHE_FRESH_MS = 36 * 3600_000;

export interface BriefSegmentRowInput {
  id: string;
  name: string;
  type: string;
  cube: string | null;
  game_id: string | null;
  workspace: string;
  uid_count: number;
  predicate_tree_json: string | null;
  cube_query_json: string | null;
  member_tiers_json?: string | null;
}

export interface SegmentBriefContext {
  segment: {
    name: string;
    game_id: string | null;
    type: string;
    member_count: number;
    /** Plain-language predicate conditions, e.g. "payer tier is whale". */
    conditions: string[];
  };
  /** Headline KPI values + top composition distributions, business-labelled. */
  enrichment: {
    kpis: Array<{ label: string; value: unknown; format?: string }>;
    distributions: Array<{ label: string; top: Array<{ value: string; count: number }> }>;
  } | null;
  tier_stats?: { top_median_ltv: number; bottom_median_ltv: number };
  data_coverage: 'full' | 'limited';
}

const OP_WORDS: Record<string, string> = {
  equals: 'is', notEquals: 'is not', gt: 'is greater than', lt: 'is less than',
  gte: 'is at least', lte: 'is at most', in: 'is one of', notIn: 'is none of',
  contains: 'contains', set: 'is present', notSet: 'is absent',
  inDateRange: 'is between', beforeDate: 'is before', afterDate: 'is after',
};

/** "ballistar_mf_users.payer_tier" → "payer tier" (prefix + cube stripped). */
function plainField(member: string): string {
  const field = member.includes('.') ? member.split('.').pop()! : member;
  return field.replace(/_/g, ' ');
}

/** Walk the predicate tree into flat plain-language condition strings. */
export function summarizePredicate(treeJson: string | null): string[] {
  if (!treeJson) return [];
  let tree: PredicateNode;
  try {
    tree = JSON.parse(treeJson) as PredicateNode;
  } catch {
    return [];
  }
  function render(node: PredicateNode): string {
    if (node.kind === 'leaf') {
      const values = (node.values ?? []).map(String).join(', ');
      const op = OP_WORDS[node.op] ?? node.op;
      return values ? `${plainField(node.member)} ${op} ${values}` : `${plainField(node.member)} ${op}`;
    }
    const parts = node.children.map(render).filter(Boolean);
    if (parts.length <= 1) return parts[0] ?? '';
    return `(${parts.join(` ${node.op} `)})`;
  }
  if (tree.kind === 'group' && tree.op === 'AND') {
    // Top-level AND renders as a flat condition list — the common shape.
    return tree.children.map(render).filter(Boolean);
  }
  const single = render(tree);
  return single ? [single] : [];
}

/** Categorical distribution cards (composition / segmented-bar / donut — all
 *  count-by-group shapes), deduped by groupBy dimension. The presentation kind
 *  is an FE concern; for the brief they're all the same top-N distribution. */
function distributionCards(preset: PresetSpec): DistributionCardSpec[] {
  const seen = new Set<string>();
  const out: DistributionCardSpec[] = [];
  for (const tab of preset.tabs) {
    for (const card of tab.cards) {
      if (!isDistributionCard(card) || seen.has(card.groupBy)) continue;
      seen.add(card.groupBy);
      out.push(card);
    }
  }
  return out;
}

/** Pick the brief's preset: direct hub-cube match, else identity-anchor pivot
 *  via the manual cube_identity_map row (cheap DB read — no /meta probing; a
 *  segment that only resolves via the auto-suggester still gets enrichment
 *  through the refresh job's card cache). */
function presetForBrief(cube: string | null, prefix: string | null): PresetSpec | null {
  if (!cube) return null;
  const logical = logicalCube(cube, prefix);
  let anchor: string | null = null;
  try {
    const row = getDb()
      .prepare('SELECT identity_field FROM cube_identity_map WHERE cube = ?')
      .get(cube) as { identity_field: string } | undefined;
    if (row?.identity_field.includes('.')) {
      anchor = logicalCube(row.identity_field.split('.')[0], prefix);
    }
  } catch {
    /* identity map unreadable — direct match only */
  }
  return pickPresetForSegment(logical, anchor);
}

interface CardLikeRow {
  rows: unknown[];
  status: 'ok' | 'error';
}

/** Map raw card rows (cached or inline) onto preset labels. Row keys are
 *  logical member names; values pass through as data for the LLM. */
function buildEnrichment(
  preset: PresetSpec,
  byCardId: Record<string, CardLikeRow>,
): SegmentBriefContext['enrichment'] {
  const kpis: Array<{ label: string; value: unknown; format?: string }> = [];
  for (const kpi of preset.headlineKpis) {
    const entry = byCardId[`kpi:${kpi.id}`];
    const first = entry?.status === 'ok' ? (entry.rows[0] as Record<string, unknown> | undefined) : undefined;
    const value = first?.[kpi.measure];
    if (value != null) kpis.push({ label: kpi.label, value, format: kpi.format });
  }

  const distributions: Array<{ label: string; top: Array<{ value: string; count: number }> }> = [];
  for (const tab of preset.tabs) {
    for (const card of tab.cards) {
      if (!isDistributionCard(card)) continue;
      if (distributions.some((d) => d.label === card.label)) continue;
      const entry = byCardId[`card:${tab.id}:${card.id}`];
      if (!entry || entry.status !== 'ok' || entry.rows.length === 0) continue;
      const top = (entry.rows as Array<Record<string, unknown>>)
        .slice(0, 6)
        .map((r) => ({ value: String(r[card.groupBy] ?? '—'), count: Number(r[card.measure] ?? 0) }));
      distributions.push({ label: card.label, top });
      if (distributions.length >= 4) break;
    }
    if (distributions.length >= 4) break;
  }

  if (kpis.length === 0 && distributions.length === 0) return null;
  return { kpis, distributions };
}

function medianLtv(members: Array<{ ltv: number | null }>): number | null {
  const vals = members.map((m) => m.ltv).filter((v): v is number => v != null).sort((a, b) => a - b);
  if (vals.length === 0) return null;
  return vals[Math.floor(vals.length / 2)];
}

function tierStats(tiersJson: string | null | undefined): SegmentBriefContext['tier_stats'] {
  if (!tiersJson) return undefined;
  try {
    const tiers = JSON.parse(tiersJson) as { tiers?: Record<string, Array<{ ltv: number | null }>> };
    const top = medianLtv(tiers.tiers?.top ?? tiers.tiers?.all ?? []);
    const bottom = medianLtv(tiers.tiers?.bottom ?? tiers.tiers?.all ?? []);
    if (top == null || bottom == null) return undefined;
    return { top_median_ltv: top, bottom_median_ltv: bottom };
  } catch {
    return undefined;
  }
}

/** True when the cached card row is recent enough to describe today's cohort. */
function isFresh(fetchedAt: string, nowMs: number): boolean {
  const t = Date.parse(fetchedAt);
  return !isNaN(t) && nowMs - t < CARD_CACHE_FRESH_MS;
}

export async function assembleBriefContext(
  row: BriefSegmentRowInput,
  nowMs: number = Date.now(),
): Promise<SegmentBriefContext> {
  const prefix = resolveGamePrefixForWorkspace(row.workspace, row.game_id);
  const preset = presetForBrief(row.cube, prefix);

  let enrichment: SegmentBriefContext['enrichment'] = null;
  if (preset) {
    // Layer 2a: fresh card-cache rows — free.
    const cached = getCardCache(row.id);
    const freshById: Record<string, CardLikeRow> = {};
    for (const [cardId, view] of Object.entries(cached)) {
      if (view.status === 'ok' && isFresh(view.fetched_at, nowMs)) {
        freshById[cardId] = { rows: view.rows, status: 'ok' };
      }
    }
    enrichment = buildEnrichment(preset, freshById);

    // Layer 2b: inline mini-run (headline KPIs + two compositions) for
    // predicate segments whose cache is cold. Failures degrade to limited.
    if (!enrichment && row.type === 'predicate' && row.cube_query_json) {
      try {
        const baseQuery = JSON.parse(row.cube_query_json) as { filters?: unknown };
        const segmentFilters = Array.isArray(baseQuery.filters) ? baseQuery.filters : [];
        const briefTab = { id: 'overview', label: 'Brief', kpis: [], cards: distributionCards(preset).slice(0, 2) };
        const miniPreset: PresetSpec = { ...preset, headlineKpis: preset.headlineKpis, tabs: [briefTab] };
        const token = row.game_id ? resolveCubeTokenForGame(row.game_id) ?? undefined : undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const entries = await runPresetCards(miniPreset, segmentFilters as any, token, prefix);
        const byId: Record<string, CardLikeRow> = {};
        for (const e of entries) byId[e.cardId] = { rows: e.rows, status: e.status };
        enrichment = buildEnrichment(preset, byId);
      } catch (err) {
        console.warn(`[segment-brief] inline enrichment failed for ${row.id}:`, (err as Error).message);
      }
    }
  }

  const tiers = tierStats(row.member_tiers_json);
  return {
    segment: {
      name: row.name,
      game_id: row.game_id,
      type: row.type,
      member_count: row.uid_count,
      conditions: summarizePredicate(row.predicate_tree_json),
    },
    enrichment,
    ...(tiers ? { tier_stats: tiers } : {}),
    data_coverage: enrichment && enrichment.kpis.length > 0 ? 'full' : 'limited',
  };
}
