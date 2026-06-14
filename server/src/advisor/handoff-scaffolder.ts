/**
 * Hand-off scaffolder — turns a ranked ExperimentCandidate into an EDITABLE
 * experiment DRAFT for the Experiment Command Center.
 *
 * The trust mechanic of the whole Advisor: accepting a recommendation NEVER
 * launches anything. It scaffolds a draft (cohort = a Segment, arms, split,
 * window, power, CS work queue, safety guardrails) that the user inspects,
 * tweaks, and explicitly launches in the command center — or kicks back to
 * Explore. status is always 'draft'.
 *
 * STUB: the real Experiment Command Center registry is not built yet, so the
 * draft is persisted in advisor_handoff_draft (migration 054) and returned for
 * inspection. When the registry ships, this scaffolder is the single seam to
 * repoint at it — the draft SHAPE here is the contract the command center
 * receives.
 *
 * PII: the draft carries user_id-keyed cohort references + numeric parameters
 * only. No contact columns — CS resolves contact details in their own tooling.
 */

import type { ExperimentCandidate } from './candidate-types.js';

/** Default treatment/hold-out window in days when the candidate has no window hint. */
const DEFAULT_WINDOW_DAYS = 14;
/**
 * Treatment share of the cohort. Hold-out is the remainder (1 - share).
 * Clamped to a hold-out floor of 15% (treatment ≤ 85%) so incrementality stays
 * measurable — mirrors the prototype's split-slider clamp (Decide page).
 */
const DEFAULT_TREATMENT_SHARE = 0.8;
const MAX_TREATMENT_SHARE = 0.85;
/** Per-player contact cap — a hard safety guardrail surfaced on every draft. */
const DEFAULT_CONTACT_CAP_PER_PLAYER = 1;
/** Do-not-contact window for recently-active payers (days). */
const DEFAULT_RECENT_PAYER_GUARD_DAYS = 7;

export interface ExperimentArm {
  /** Arm key — 'treatment' receives the lever; 'holdout' is untouched. */
  key: 'treatment' | 'holdout';
  label: string;
  /** Fraction of the addressable cohort assigned to this arm (0–1). */
  share: number;
}

export interface SafetyGuardrails {
  /** Max contacts per player across the experiment window. */
  contactCapPerPlayer: number;
  /** Suppress players who paid within this many days. */
  recentPayerGuardDays: number;
  /** Hold-out is measured (incrementality), never silently dropped. */
  holdoutMeasured: true;
}

/**
 * The scaffolded draft. This is the contract handed to the command center.
 * status is always 'draft' — the Advisor cannot launch.
 */
export interface ExperimentDraft {
  /** Deterministic id = `${segmentId}::${candidateId}` (idempotent re-scaffold). */
  draftId: string;
  segmentId: string;
  gameId: string;
  candidateId: string;
  status: 'draft';
  /** Plain-language hypothesis (first phrased hypothesis if present, else rankReason). */
  hypothesis: string;
  /** Cohort the experiment runs on — a Segment reference (reuses predicate engine). */
  cohort: {
    segmentId: string;
    /** Estimated addressable N at scaffold time (≈ diagnosis N). */
    addressableN: number;
    /** Fraction reachable by the lever's actuator channel. */
    reachablePct: number;
  };
  arms: ExperimentArm[];
  windowDays: number;
  /** Carried from the candidate so the command center keeps the power story. */
  power: ExperimentCandidate['power'];
  /** Expected effect + its confidence/source — never presented as launched truth. */
  expectedEffect: ExperimentCandidate['expectedEffect'];
  money: ExperimentCandidate['money'];
  feasibility: ExperimentCandidate['feasibility'];
  /** Linked VIP-Care playbook → CS work queue (null when no direct playbook). */
  playbookId?: string;
  /**
   * Delivery ownership. CS-actuated levers route to the in-system CS queue;
   * 'external' levers export a no-PII target list for manual/hand-logged delivery.
   */
  delivery: 'cs-queue' | 'external';
  safety: SafetyGuardrails;
}

export interface ScaffoldInput {
  candidate: ExperimentCandidate;
  segmentId: string;
  gameId: string;
  addressableN: number;
  reachablePct: number;
  /** Override window; defaults to 14d. */
  windowDays?: number;
  /** Override treatment share; clamped to ≤ 0.85 so hold-out ≥ 15%. */
  treatmentShare?: number;
}

/**
 * Build an editable experiment draft from a candidate. Pure — no I/O, no
 * persistence (the route persists via the draft store). Deterministic given
 * the same input, so re-scaffolding is idempotent.
 */
export function scaffoldDraft(input: ScaffoldInput): ExperimentDraft {
  const { candidate, segmentId, gameId, addressableN, reachablePct } = input;

  const draftId = `${segmentId}::${candidate.id}`;
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;

  // Clamp treatment share so the hold-out never drops below 15%.
  const treatmentShare = Math.min(
    input.treatmentShare ?? DEFAULT_TREATMENT_SHARE,
    MAX_TREATMENT_SHARE,
  );
  const holdoutShare = parseFloat((1 - treatmentShare).toFixed(4));

  const hypothesis = candidate.hypotheses?.[0] ?? candidate.rankReason;

  // CS-actuated levers deliver via the in-system queue; anything else exports a
  // no-PII target list for external/manual delivery (the action is often
  // outside our system — see the command-center hand-off contract).
  const delivery: ExperimentDraft['delivery'] =
    candidate.lever.actuator === 'cs' ? 'cs-queue' : 'external';

  return {
    draftId,
    segmentId,
    gameId,
    candidateId: candidate.id,
    status: 'draft',
    hypothesis,
    cohort: { segmentId, addressableN, reachablePct },
    arms: [
      { key: 'treatment', label: 'Treatment', share: treatmentShare },
      { key: 'holdout', label: 'Hold-out (measured)', share: holdoutShare },
    ],
    windowDays,
    power: candidate.power,
    expectedEffect: candidate.expectedEffect,
    money: candidate.money,
    feasibility: candidate.feasibility,
    playbookId: candidate.playbookId,
    delivery,
    safety: {
      contactCapPerPlayer: DEFAULT_CONTACT_CAP_PER_PLAYER,
      recentPayerGuardDays: DEFAULT_RECENT_PAYER_GUARD_DAYS,
      holdoutMeasured: true,
    },
  };
}
