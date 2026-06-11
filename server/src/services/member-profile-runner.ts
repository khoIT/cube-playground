/**
 * Ranked member-profile snapshot. At segment-refresh time, loads the cohort's
 * top members by the segment's rank measure (see segment-rank-measure.ts)
 * together with the preset's member columns (in-game name, lifecycle dates,
 * LTV) in ONE Cube query, and serializes them for the tokenless members pull
 * API — a CS tool reads enriched rows with zero per-request Cube cost.
 *
 * Predicate-scoped like tiers/cards (never an inlined uid-IN list). Columns
 * whose member doesn't exist in this game's /meta are dropped up front — one
 * unknown member would otherwise 400 the whole query (the Members-tab bug
 * shape, applied server-side). Any failure returns null: profiles are an
 * enhancement and must never break or delay-fail a refresh.
 */

import { loadWithContinueWait } from './load-with-continue-wait.js';
import { physicalizeQuery, physicalMember } from './cube-member-resolver.js';
import type { MetaMemberSets } from './cube-meta-members.js';
import type { RankFilter } from './segment-rank-measure.js';
import type { MemberProfiles, MemberProfileColumn } from '../types/segment.js';

/** Snapshot size cap — also the pull API's max useful `limit`. */
export const MEMBER_PROFILE_LIMIT = 1000;

const PROFILE_TIMEOUT_MS = 30_000;

/** Preset memberColumns arrive untyped from the bundle/TS preset. */
interface RawMemberColumn {
  id?: unknown;
  label?: unknown;
  dimension?: unknown;
  measure?: unknown;
  format?: unknown;
}

export interface ComputeMemberProfilesArgs {
  /** Identity dimension, same value space as the stored uid_list. */
  identityDim: string;
  /** Ranking measure (segment-defining metric or preset LTV); null = unranked. */
  rankMeasure: string | null;
  /** preset.memberColumns, untyped — entries lacking id/label/member are skipped. */
  memberColumns: Array<Record<string, unknown>>;
  /** /meta member catalog; null = unavailable → keep all columns (legacy posture). */
  metaSets: MetaMemberSets | null;
  segmentFilters: RankFilter[];
  cubeSegments?: string[];
  totalCount: number;
  tokenOverride?: string;
  prefix: string | null;
}

interface ParsedColumn extends MemberProfileColumn {
  kind: 'dimension' | 'measure';
}

function parseColumns(
  raw: Array<Record<string, unknown>>,
  metaSets: MetaMemberSets | null,
  prefix: string | null,
): ParsedColumn[] {
  const out: ParsedColumn[] = [];
  for (const entry of raw as RawMemberColumn[]) {
    const field =
      typeof entry.dimension === 'string'
        ? entry.dimension
        : typeof entry.measure === 'string'
          ? entry.measure
          : null;
    if (!field || typeof entry.id !== 'string') continue;
    const kind: ParsedColumn['kind'] = typeof entry.dimension === 'string' ? 'dimension' : 'measure';
    // Drop columns this game's model doesn't have (e.g. ingame_name outside jus).
    if (metaSets) {
      const known = kind === 'dimension' ? metaSets.dimensions : metaSets.measures;
      if (!known.has(physicalMember(field, prefix))) continue;
    }
    out.push({
      key: entry.id.replace(/-/g, '_'),
      label: typeof entry.label === 'string' ? entry.label : entry.id,
      field,
      ...(typeof entry.format === 'string' ? { format: entry.format } : {}),
      kind,
    });
  }
  return out;
}

function extractRows(loadResult: unknown): Array<Record<string, unknown>> {
  const r = loadResult as {
    data?: Array<Record<string, unknown>>;
    results?: Array<{ data?: Array<Record<string, unknown>> }>;
  };
  return r.data ?? r.results?.[0]?.data ?? [];
}

export async function computeMemberProfiles(
  args: ComputeMemberProfilesArgs,
): Promise<MemberProfiles | null> {
  const {
    identityDim, rankMeasure, memberColumns, metaSets,
    segmentFilters, cubeSegments, totalCount, tokenOverride, prefix,
  } = args;
  if (totalCount <= 0) return null;

  const columns = parseColumns(memberColumns, metaSets, prefix);
  // Nothing beyond bare uids to offer — the plain uid_list already covers that.
  if (columns.length === 0 && !rankMeasure) return null;

  const dimensions = [identityDim, ...columns.filter((c) => c.kind === 'dimension').map((c) => c.field)];
  const measures = [
    ...new Set([
      ...(rankMeasure ? [rankMeasure] : []),
      ...columns.filter((c) => c.kind === 'measure').map((c) => c.field),
    ]),
  ];
  // Rank by the measure when there is one; identity order keeps the snapshot
  // deterministic either way (and breaks rank ties stably across runs).
  const order: Record<string, 'asc' | 'desc'> = rankMeasure
    ? { [rankMeasure]: 'desc', [identityDim]: 'asc' }
    : { [identityDim]: 'asc' };

  const query = {
    dimensions,
    measures,
    order,
    limit: Math.min(totalCount, MEMBER_PROFILE_LIMIT),
    ...(segmentFilters.length > 0 ? { filters: segmentFilters } : {}),
    ...(cubeSegments && cubeSegments.length > 0 ? { segments: cubeSegments } : {}),
  };

  try {
    // Read rows by PHYSICAL keys taken from the physicalized query/columns —
    // same posture as the tier runner, no logical/physical ambiguity.
    const physical = physicalizeQuery(query, prefix);
    const uidKey = physical.dimensions[0];
    const raw = await loadWithContinueWait(physical, tokenOverride, PROFILE_TIMEOUT_MS);

    const rows: MemberProfiles['rows'] = [];
    for (const row of extractRows(raw)) {
      const uid = row[uidKey];
      if (uid == null) continue;
      const out: Record<string, unknown> & { uid: string } = { uid: String(uid) };
      for (const c of columns) out[c.key] = row[physicalMember(c.field, prefix)] ?? null;
      rows.push(out);
    }
    if (rows.length === 0) return null; // transient empty result — never cache it

    return {
      computed_at: new Date().toISOString(),
      rank_measure: rankMeasure,
      columns: columns.map(({ kind: _kind, ...col }) => col),
      rows,
    };
  } catch (err) {
    console.warn('[member-profile-runner] profile snapshot failed:', (err as Error).message);
    return null;
  }
}
