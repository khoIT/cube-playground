/**
 * Public-facing segment shape for the documented API. Decoupled from the
 * internal `segments` row via an EXPLICIT allowlist mapper (never `{...row}`) so
 * an internal column can't accidentally leak onto the public surface.
 */

import { AVAILABLE_FIELDS } from './segment-export-stream.js';

/** Real prod base for export URLs + OpenAPI servers (behind VPN). */
export function publicApiBaseUrl(): string {
  return process.env.PUBLIC_API_BASE_URL ?? 'https://playground.gds.vng.vn';
}

export interface PublicSegment {
  id: string;
  name: string;
  game_id: string;
  workspace: string;
  /** Distinct uid count of the cohort (the pull size). */
  size: number;
  /** 'fresh' | 'refreshing' | 'broken' | 'stale' — pull only when 'fresh'. */
  status: string;
  /** ISO timestamp of the last refresh, or null. */
  last_refreshed_at: string | null;
  /** 'predicate' (live) or 'manual' (frozen uid list). */
  type: string;
}

export interface PublicSegmentDetail extends PublicSegment {
  /** Columns this key may request via `?fields=` (grows over time within v1). */
  available_fields: string[];
  /** Absolute streaming export URL for this segment. */
  members_url: string;
  /** Whether a lakehouse daily partition exists (table path) vs live predicate. */
  snapshot_partition_exists: boolean;
}

interface RawSegmentRow {
  id?: unknown;
  name?: unknown;
  game_id?: unknown;
  workspace?: unknown;
  uid_count?: unknown;
  status?: unknown;
  last_refreshed_at?: unknown;
  type?: unknown;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function toPublicSegment(row: RawSegmentRow): PublicSegment {
  return {
    id: str(row.id),
    name: str(row.name),
    game_id: str(row.game_id),
    workspace: str(row.workspace),
    size: typeof row.uid_count === 'number' ? row.uid_count : Number(row.uid_count ?? 0),
    status: str(row.status, 'unknown'),
    last_refreshed_at: row.last_refreshed_at ? str(row.last_refreshed_at) : null,
    type: str(row.type),
  };
}

export function toPublicSegmentDetail(
  row: RawSegmentRow,
  opts: { snapshotPartitionExists: boolean },
): PublicSegmentDetail {
  const base = toPublicSegment(row);
  return {
    ...base,
    available_fields: [...AVAILABLE_FIELDS],
    members_url: `${publicApiBaseUrl()}/api/public/v1/segments/${base.id}/members`,
    snapshot_partition_exists: opts.snapshotPartitionExists,
  };
}
