/**
 * cs-case-actions — thin wrappers over patchCareCase for the three CS-queue
 * mutations: claim (assign to me), unclaim (clear assignee), dismiss with reason.
 *
 * Centralising the payload shapes here means the rail and the queue rows both
 * call the same function — the exact PATCH body is tested in one place and
 * can never silently diverge between surfaces.
 *
 * Reason encoding convention: dismissed cases store `notes = "reason:<code>"`.
 * parseDismissReason() is the single decode point used by the timeline and any
 * future surface that needs to display "Dismissed · <label>".
 */

import { patchCareCase } from './use-care-cases';
import type { CareCase } from './use-care-cases';

// ── Dismiss reason enum + labels ──────────────────────────────────────────────

/**
 * Fixed set of dismiss reason codes.  Keeping this closed prevents free-text
 * drift that would break the history decode — the timeline always expects one
 * of these four values after the "reason:" prefix.
 */
export const DISMISS_REASONS = {
  false_positive:   'False positive',
  not_now:          'Not now',
  already_handled:  'Already handled',
  ineligible:       'Ineligible',
} as const;

export type DismissReasonCode = keyof typeof DISMISS_REASONS;

// ── Payload helpers ───────────────────────────────────────────────────────────

/**
 * Claim a case by assigning it to the current agent.
 * Only sets `assignee` — leaves status and every other field untouched.
 */
export function claimCase(id: string, me: string): Promise<CareCase> {
  return patchCareCase(id, { assignee: me });
}

/**
 * Release ownership by setting assignee to null.
 * The server treats a null assignee as "unassigned / available to anyone".
 */
export function unclaimCase(id: string): Promise<CareCase> {
  // Cast required because CareCasePatch types assignee as string, but the
  // server contract explicitly allows null to clear the field.
  return patchCareCase(id, { assignee: null as unknown as string });
}

/**
 * Dismiss a case with a structured reason.
 *
 * Encodes the reason as `notes = "reason:<code>"` so the history timeline can
 * decode it back to a human label via parseDismissReason().  The status moves
 * to 'dismissed' which removes the case from the open queue automatically
 * (server-side filter on by-vip and list endpoints).
 */
export function dismissCase(id: string, reasonCode: DismissReasonCode): Promise<CareCase> {
  return patchCareCase(id, {
    status: 'dismissed',
    notes: `reason:${reasonCode}`,
  });
}

// ── KPI outcome close ────────────────────────────────────────────────────────

/**
 * Allowed KPI outcome values when closing a treated case.
 *
 * 'na' exists in the server enum but is intentionally excluded here — the UI
 * only surfaces met/missed; 'na' is reserved for future auto-eval scenarios
 * and must not be reachable from the CS agent's Close buttons.
 */
export type CloseOutcome = 'kpi_met' | 'kpi_missed';

/**
 * Close a treated case with a human-assigned KPI outcome.
 *
 * Stamps status → resolved and outcome in one PATCH.  The server also sets
 * closed_at on the resolved transition, removing the case from the open queue.
 *
 * Only offered in the UI when the case is already 'treated' — enforcing the
 * claim → treat → close loop.
 */
export function closeCaseWithOutcome(id: string, outcome: CloseOutcome): Promise<CareCase> {
  return patchCareCase(id, { status: 'resolved', outcome });
}

// ── Decode ────────────────────────────────────────────────────────────────────

/**
 * Extract the reason code from a dismissed case's notes field.
 *
 * Returns the raw code (e.g. "not_now") if notes starts with "reason:", or
 * null if notes is absent / free-text / doesn't follow the convention.
 * Callers map the code through DISMISS_REASONS[code] for the display label.
 */
export function parseDismissReason(
  notes: string | null | undefined,
): DismissReasonCode | null {
  if (!notes) return null;
  const PREFIX = 'reason:';
  if (!notes.startsWith(PREFIX)) return null;
  const code = notes.slice(PREFIX.length) as DismissReasonCode;
  // Guard against unknown codes persisted by older clients or manual edits.
  return code in DISMISS_REASONS ? code : null;
}
