/**
 * Server-side label resolver for the Settings "Remembered defaults" view.
 *
 * Avoids a FE round-trip to cube /meta by deriving a readable display
 * string for each user pref row here. Returns the resolved label string
 * plus a normalised value the FE can render directly.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface MemberEntry {
  name: string;
  shortTitle?: string;
  title?: string;
}

/** Flatten the cube /meta payload into a Map keyed by member name. */
export function buildMemberIndex(meta: any): Map<string, MemberEntry> {
  const out = new Map<string, MemberEntry>();
  const cubes: any[] = meta?.cubes ?? [];
  for (const cube of cubes) {
    for (const m of (cube.measures ?? []) as MemberEntry[]) out.set(m.name, m);
    for (const d of (cube.dimensions ?? []) as MemberEntry[]) out.set(d.name, d);
  }
  return out;
}

function titleOf(idx: Map<string, MemberEntry>, ref: string): string {
  const e = idx.get(ref);
  return e?.shortTitle ?? e?.title ?? ref;
}

function formatTimeRangeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'dateRange' in (value as Record<string, unknown>)) {
    const dr = (value as { dateRange: unknown }).dateRange;
    if (typeof dr === 'string') return dr;
    if (Array.isArray(dr) && dr.length === 2) return `${dr[0]} → ${dr[1]}`;
  }
  return '';
}

export interface ResolvedRow {
  slot: string;
  value: unknown;
  phrase?: string;
  label: string;
  lastUsedAt: number;
  hitCount: number;
}

export function resolveLabel(
  slot: string,
  value: unknown,
  phrase: string | undefined,
  memberIndex: Map<string, MemberEntry>,
): string {
  if (slot === 'metric' || slot === 'dimension') {
    return titleOf(memberIndex, String(value));
  }
  if (slot === 'timeRange') {
    return phrase ?? formatTimeRangeValue(value);
  }
  if (slot.startsWith('filter:')) {
    const member = slot.slice('filter:'.length);
    return `Filter (${titleOf(memberIndex, member)})`;
  }
  return slot;
}
