/**
 * Pure transform functions that convert raw CareCase ledger records into the
 * display shapes used by the Member-360 care surfaces.
 *
 * Keeping these outside React means they're unit-testable without a DOM and
 * reusable across the view and any future summarisation layers.
 */

import type { CareCase } from '../use-care-cases';
import { parseDismissReason, DISMISS_REASONS } from '../cs-case-actions';
import type {
  CareTimelineEvent,
  CareEventKind,
  CarePriority,
  CareChannel,
  RecommendedAction,
} from './cs-member360-mock';

// ── Priority normalisation ─────────────────────────────────────────────────

/**
 * Normalise the server's flexible playbook_priority field into the three-tier
 * CarePriority display type.
 *
 * The server stores priority as a numeric rank (1 = highest) or as a legacy
 * string label. We map both to the canonical three-bucket scale so the UI only
 * ever deals with one type.
 */
export function normalisePriority(raw: number | string | undefined): CarePriority {
  if (raw === 'cao' || raw === 'tb' || raw === 'thap') return raw;
  const n = typeof raw === 'string' ? parseInt(raw, 10) : (raw ?? 99);
  if (n <= 1) return 'cao';
  if (n <= 3) return 'tb';
  return 'thap';
}

// ── Status → kind mapping ─────────────────────────────────────────────────

function statusToKind(status: CareCase['status']): CareEventKind {
  switch (status) {
    case 'treated':
      return 'treated';
    case 'resolved':
      return 'resolved';
    case 'dismissed':
      // Dismissed maps to a note-style event — no dedicated kind, closest is note.
      return 'note';
    default:
      // new / in_review → the case is still open.
      return 'opened';
  }
}

// ── Days-ago helper ────────────────────────────────────────────────────────

function daysAgoFrom(isoDate: string | null | undefined): number {
  if (!isoDate) return 0;
  const msPerDay = 86_400_000;
  return Math.max(0, Math.round((Date.now() - new Date(isoDate).getTime()) / msPerDay));
}

// ── Case → timeline event ─────────────────────────────────────────────────

/**
 * Map a single CareCase record to a CareTimelineEvent for the history spine.
 *
 * The primary timestamp anchoring an event is:
 *  - `treated_at` for treated/resolved cases (most informative to display)
 *  - `opened_at` for open/new/in_review cases
 */
function caseToTimelineEvent(c: CareCase): CareTimelineEvent {
  const kind = statusToKind(c.status);
  const anchorDate = (kind === 'treated' || kind === 'resolved') && c.treated_at
    ? c.treated_at
    : c.opened_at;

  // Decode structured dismiss reason so the timeline shows a human label
  // ("Dismissed · Not now") instead of the raw "reason:not_now" storage token.
  let note: string | undefined = c.notes ?? undefined;
  if (c.status === 'dismissed' && note) {
    const reasonCode = parseDismissReason(note);
    if (reasonCode) {
      note = `Dismissed · ${DISMISS_REASONS[reasonCode]}`;
    }
  }

  return {
    id: `evt-${c.id}`,
    kind,
    playbookId: c.playbook_id,
    playbookName: c.playbook_name ?? c.playbook_id,
    priority: normalisePriority(c.playbook_priority),
    daysAgo: daysAgoFrom(anchorDate),
    channel: (c.channel_used as CareChannel | null) ?? undefined,
    agent: c.assignee ?? undefined,
    outcome: c.outcome as CareTimelineEvent['outcome'] ?? undefined,
    note,
  };
}

/**
 * Convert a flat array of CareCase records into CareTimelineEvent[].
 *
 * Sorted newest-first (by opened_at desc) so the most recent event sits at the
 * top of the spine, matching the CS agent's mental model of "what's happening now".
 */
export function casesToTimeline(cases: CareCase[]): CareTimelineEvent[] {
  return [...cases]
    .sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime())
    .map(caseToTimelineEvent);
}

// ── Pick highest-priority open case ───────────────────────────────────────

const OPEN_STATUSES = new Set<CareCase['status']>(['new', 'in_review']);

/**
 * Return the single most-urgent open case for the Member-360 action rail.
 *
 * "Open" means status ∈ {new, in_review} — treated cases remain visible in
 * history but are no longer the primary action target.
 *
 * Tie-breaking: lower numeric priority rank wins; if equal, the earlier
 * opened_at wins (first-in, first-served ordering).
 */
export function pickTopOpenCase(cases: CareCase[]): CareCase | null {
  const open = cases.filter((c) => OPEN_STATUSES.has(c.status));
  if (open.length === 0) return null;

  return open.reduce((best, c) => {
    const bestN = typeof best.playbook_priority === 'string'
      ? parseInt(best.playbook_priority, 10)
      : (best.playbook_priority ?? 99);
    const cN = typeof c.playbook_priority === 'string'
      ? parseInt(c.playbook_priority, 10)
      : (c.playbook_priority ?? 99);

    if (cN < bestN) return c;
    if (cN === bestN && c.opened_at < best.opened_at) return c;
    return best;
  });
}

// ── Case → recommended action ─────────────────────────────────────────────

/**
 * Generic guidance text derived from a case's playbook name and priority.
 * Intentionally non-VIP-specific so it works across any member that surfaces
 * in the care queue — the CS agent personalises it in the actual call.
 */
export interface PlaybookGuidance {
  /** Agent talk-track / opening line. */
  script: string;
  /** Cross-sell / retention bundle to mention. */
  bundle: string;
  /** Service-level reminder. */
  slaNote: string;
  /** Why the VIP surfaced — the deciding signal. Keep concise. */
  why: string;
  /** Preferred outreach channels for this playbook. */
  channels: CareChannel[];
}

/**
 * Derive a RecommendedAction display object from the top open case.
 *
 * Callers supply `guidance` so the function stays pure and testable without
 * any domain knowledge baked in. The view builds guidance from the playbook
 * registry or falls back to sensible defaults.
 */
export function caseToRecommendedAction(
  c: CareCase,
  guidance: PlaybookGuidance,
): RecommendedAction {
  return {
    playbookId: c.playbook_id,
    playbookName: c.playbook_name ?? c.playbook_id,
    priority: normalisePriority(c.playbook_priority),
    why: guidance.why,
    channels: guidance.channels,
    script: guidance.script,
    bundle: guidance.bundle,
    slaNote: guidance.slaNote,
  };
}

// ── Default guidance fallback ─────────────────────────────────────────────

/**
 * Build a sensible generic guidance block when no playbook-specific content is
 * available. All text is deliberately generic so it reads as instructional
 * scaffolding rather than fictional VIP data.
 */
export function defaultGuidance(
  playbookName: string,
  priority: CarePriority,
): PlaybookGuidance {
  const slaByPriority: Record<CarePriority, string> = {
    cao: 'Cao priority — first contact target within 24 h of case opening.',
    tb: 'TB priority — first contact target within 72 h.',
    thap: 'Thấp priority — address within the current sprint cycle.',
  };
  return {
    why: `VIP matched playbook "${playbookName}". Review the case stats for the specific trigger.`,
    channels: ['call', 'zalo_zns'],
    script: 'Open warm, confirm the VIP is reachable, and address the playbook trigger before any offer.',
    bundle: 'Refer to the playbook offer guidelines for this case type.',
    slaNote: slaByPriority[priority],
  };
}
