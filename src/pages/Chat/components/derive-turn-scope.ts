/**
 * deriveTurnScope — distil a turn's query scope into a glanceable badge model.
 *
 * Each data-backed turn already carries its CubeQuery on the emitted
 * query_artifact(s). Rather than a single session-level focus chip, we surface
 * the scope of *this* turn — the members it touched and the date window — right
 * under the question, so a reader scanning history sees what each answer was
 * actually about. Pure + FE-only: no backend or turn-shape change.
 *
 * The primary artifact (first query_artifact) drives the badge; any further
 * artifacts in the same turn are summarised as `extraArtifacts` (the "+N"
 * affordance). Turns with no query_artifact (clarifications, chit-chat) return
 * null and render no badge.
 */
import type { QueryArtifact } from '../../../api/chat-sse-client';

/** Max member chips shown before the rest fold into `hiddenMemberCount`. */
const MEMBER_DISPLAY_CAP = 4;

export interface TurnScope {
  /** Fully-qualified members (measures then dimensions) shown as code chips. */
  members: string[];
  /** Members beyond MEMBER_DISPLAY_CAP, summarised as "+N fields". */
  hiddenMemberCount: number;
  /** Human-readable date window, or null when the query carries none. */
  dateRange: string | null;
  /** Additional query artifacts in the turn beyond the primary (the "+N"). */
  extraArtifacts: number;
}

/** Loose view of a CubeQuery — the artifact carries `query: unknown`, so we
 *  read defensively and ignore anything off-shape. */
interface LooseCubeQuery {
  measures?: unknown;
  dimensions?: unknown;
  timeDimensions?: unknown;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Format a CubeQuery dateRange — either a preset string ("last 30 days") or a
 *  [start, end] ISO tuple — into a compact label. */
function formatDateRange(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw.length === 2) {
    const [start, end] = raw;
    const fmt = (s: unknown): string => {
      if (typeof s !== 'string') return '';
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return s;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };
    const a = fmt(start);
    const b = fmt(end);
    if (a && b) return `${a} – ${b}`;
  }
  return null;
}

function firstDateRange(timeDimensions: unknown): string | null {
  if (!Array.isArray(timeDimensions)) return null;
  for (const td of timeDimensions) {
    if (td && typeof td === 'object' && 'dateRange' in td) {
      const label = formatDateRange((td as { dateRange?: unknown }).dateRange);
      if (label) return label;
    }
  }
  return null;
}

export function deriveTurnScope(artifacts: QueryArtifact[]): TurnScope | null {
  if (artifacts.length === 0) return null;
  const primary = artifacts[0];
  const q = (primary.query ?? {}) as LooseCubeQuery;

  const allMembers = [...asStringArray(q.measures), ...asStringArray(q.dimensions)];
  const members = allMembers.slice(0, MEMBER_DISPLAY_CAP);
  const hiddenMemberCount = Math.max(0, allMembers.length - members.length);
  const dateRange = firstDateRange(q.timeDimensions);

  // A turn with an artifact but no members AND no date carries nothing worth a
  // badge (e.g. a segment pointer) — suppress rather than show an empty pill.
  if (members.length === 0 && !dateRange) return null;

  return {
    members,
    hiddenMemberCount,
    dateRange,
    extraArtifacts: Math.max(0, artifacts.length - 1),
  };
}
