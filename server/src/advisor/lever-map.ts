/**
 * Maps an Opportunity's factor key → lever family → concrete playbook(s) from
 * the VIP-Care registry (21 playbooks).
 *
 * Feasibility is encoded honestly:
 *   - CS-actuated levers (call, zalo_zns, in_game via the VIP console) = 'feasible'
 *   - Levers needing push-notification infra or pricing engine = 'nearest-feasible'
 *     with a `substitute` pointing to the CS-delivered equivalent.
 *   - Factors with no lever path today → single 'infeasible' candidate so the
 *     absence is visible rather than silently dropped.
 *
 * Today's actuator perimeter: CS team + VIP Care console (call, zalo_zns, in_game).
 * Push and system-offer channels are available in playbooks but require an automated
 * delivery layer not yet built — those are marked nearest-feasible until that ships.
 */

import { SEED_PLAYBOOKS, type Playbook } from '../care/playbook-registry.js';
import type {
  FeasibilityVerdict,
  FeasibilityStatus,
  LeverRef,
} from './candidate-types.js';
import type { Opportunity } from './diagnosis-types.js';

// ─── Lever family definitions ────────────────────────────────────────────────

/** A lever family groups related playbooks by the intervention pattern. */
export interface LeverFamily {
  /** Slug referenced by the map below (e.g. "win-back"). */
  family: string;
  /** Factor keys this family targets. */
  factorKeys: string[];
  actuator: 'cs' | 'system';
  description: string;
  /** Playbook IDs from the registry this family maps to. */
  playbookIds: string[];
  /**
   * When a better lever exists but needs infra not available (actuator='system'),
   * this family is the substitute to reference.
   */
  isSubstituteFor?: string;
}

/**
 * The canonical factor → lever family map.
 *
 * Factor keys mirror the Decomposition lens outputs:
 *   revenue tree  : "payers", "arppu", "lifespan"
 *   engagement tree: "session_freq", "session_length", "lifespan"
 * Plus cs-ticket-specific factors: "ticket_sentiment", "spend_drop", "session_drop".
 */
const LEVER_FAMILIES: LeverFamily[] = [
  // ── Lifespan / churn ─────────────────────────────────────────────────────
  {
    family: 'win-back',
    factorKeys: ['lifespan'],
    actuator: 'cs',
    description: 'Reach lapsing VIPs via call/Zalo; comeback incentive to restore activity.',
    playbookIds: ['14'], // "No login ≥ N days"
  },
  {
    family: 'session-recovery',
    factorKeys: ['lifespan', 'session_freq', 'session_length'],
    actuator: 'cs',
    description: 'Re-engage players whose session time has dropped; surface fresh content.',
    playbookIds: ['15'], // "Session-time drop"
  },
  {
    family: 'social-reconnect',
    factorKeys: ['lifespan', 'session_freq'],
    actuator: 'cs',
    description: 'Reconnect socially disengaged players; suggest active guilds.',
    playbookIds: ['17'], // "Leave / disband guild"
  },

  // ── Payers / ARPPU ────────────────────────────────────────────────────────
  {
    family: 'spend-drop-recovery',
    factorKeys: ['payers', 'arppu'],
    actuator: 'cs',
    description: 'Reach out to VIPs whose spend has dropped; targeted retention offer via call.',
    playbookIds: ['04'], // "Spend drop"
  },
  {
    family: 'first-deposit-followup',
    factorKeys: ['payers'],
    actuator: 'cs',
    description: 'Welcome new payers; nudge toward second deposit via in-game + Zalo.',
    playbookIds: ['01'], // "First deposit"
  },
  {
    family: 'tier-advancement',
    factorKeys: ['arppu', 'payers'],
    actuator: 'cs',
    description: 'Congratulate VIP tier crossings; deliver benefits to sustain ARPU.',
    playbookIds: ['02'], // "VIP tier reached"
  },
  {
    family: 'spend-spike-acknowledgment',
    factorKeys: ['arppu'],
    actuator: 'cs',
    description: 'Acknowledge big-spend events; VIP perk + fraud/refund sanity check.',
    playbookIds: ['03'], // "Spend spike"
  },
  {
    family: 'payment-failure-assist',
    factorKeys: ['payers'],
    actuator: 'cs',
    description: 'Assist players with failed payments; offer alternative channels.',
    playbookIds: ['05'], // "Payment failure" — blocked in registry (no data source)
  },

  // ── Engagement / session ──────────────────────────────────────────────────
  {
    family: 'morale-boost',
    factorKeys: ['session_freq', 'session_length'],
    actuator: 'cs',
    description: 'Encourage VIPs after rank slumps or loss streaks; coaching tips.',
    playbookIds: ['08'], // "Rank drop / loss streak"
  },
  {
    family: 'achievement-recognition',
    factorKeys: ['session_freq', 'session_length'],
    actuator: 'cs',
    description: 'Celebrate top performance; featured status + premium reward.',
    playbookIds: ['06', '09'], // "Top leaderboard", "Major achievement"
  },
  {
    family: 'gacha-goodwill',
    factorKeys: ['session_length', 'arppu'],
    actuator: 'cs',
    description: 'Soften bad-luck streaks; goodwill compensation in-game.',
    playbookIds: ['12'], // "Gacha bad-luck"
  },
  {
    family: 'collector-nudge',
    factorKeys: ['session_length'],
    actuator: 'cs',
    description: 'Nudge near-complete collectors; last-piece availability message.',
    playbookIds: ['11'], // "Collector FOMO"
  },
  {
    family: 'cosmetic-recognition',
    factorKeys: ['session_freq'],
    actuator: 'cs',
    description: 'Recognize rare cosmetic unlocks; collector identity reinforcement.',
    playbookIds: ['07'], // "Cosmetic / rare unlock"
  },

  // ── Automated push (available in registry but actuator=system today) ──────
  {
    family: 'push-re-engagement',
    factorKeys: ['session_freq', 'lifespan'],
    actuator: 'system',
    description: 'Automated push re-engagement (requires push delivery infra).',
    playbookIds: ['15'],
    isSubstituteFor: 'session-recovery', // session-recovery IS the CS substitute
  },
  {
    family: 'system-offer',
    factorKeys: ['payers', 'arppu'],
    actuator: 'system',
    description: 'Price-anchored system offer (requires pricing engine not yet built).',
    playbookIds: [],
    isSubstituteFor: 'spend-drop-recovery',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Playbooks that are permanently blocked (no data source). */
function isPlaybookBlocked(pb: Playbook): boolean {
  return pb.availabilityHints?.blocked === true;
}

/** Build a LeverRef from a LeverFamily. */
function toLeverRef(family: LeverFamily): LeverRef {
  return {
    family: family.family,
    actuator: family.actuator,
    description: family.description,
  };
}

/**
 * Build a FeasibilityVerdict for a family.
 *
 * CS families are 'feasible' unless every mapped playbook is blocked.
 * System families are 'nearest-feasible' with a substitute pointing to the CS sibling.
 */
function buildVerdict(family: LeverFamily): FeasibilityVerdict {
  const lever = toLeverRef(family);

  if (family.actuator === 'system') {
    // Find the CS substitute family
    const sub = LEVER_FAMILIES.find((f) => f.family === family.isSubstituteFor);
    return {
      status: 'nearest-feasible' as FeasibilityStatus,
      lever,
      why: `${family.family} requires automated delivery infra not yet available.`,
      substitute: sub
        ? `CS-delivered equivalent: ${sub.family} — ${sub.description}`
        : 'No CS substitute mapped yet.',
    };
  }

  // CS actuator — check if every playbook is data-blocked
  const playbooks = family.playbookIds
    .map((id) => SEED_PLAYBOOKS.find((p) => p.id === id))
    .filter(Boolean) as Playbook[];

  if (playbooks.length > 0 && playbooks.every(isPlaybookBlocked)) {
    return {
      status: 'infeasible' as FeasibilityStatus,
      lever,
      why: `All mapped playbooks (${family.playbookIds.join(', ')}) are data-blocked (no source modeled).`,
    };
  }

  return { status: 'feasible' as FeasibilityStatus, lever };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** The full lever-family taxonomy (read-only) — used to seed the agent context pack. */
export function listLeverFamilies(): readonly LeverFamily[] {
  return LEVER_FAMILIES;
}

export interface MappedLever {
  family: LeverFamily;
  verdict: FeasibilityVerdict;
  /** First non-blocked playbook ID from the family, if any. */
  primaryPlaybookId?: string;
}

/**
 * Map an opportunity's factor → all matching lever families.
 *
 * - System families (push/pricing) are included only if they have a distinct
 *   factor mapping not covered by a CS family — avoids duplicate entries.
 * - If no family matches the factor, returns a single 'infeasible' sentinel.
 */
export function mapLevers(opportunity: Opportunity): MappedLever[] {
  const factor = opportunity.factor;

  const matching = LEVER_FAMILIES.filter(
    (f) => f.factorKeys.includes(factor) && f.actuator === 'cs',
  );

  // Also include system families that have no CS sibling for this factor
  const systemOnly = LEVER_FAMILIES.filter((f) => {
    if (f.actuator !== 'system') return false;
    if (!f.factorKeys.includes(factor)) return false;
    // Skip if a CS family already covers the same factor
    return !matching.some((cs) => cs.factorKeys.some((k) => f.factorKeys.includes(k)));
  });

  const all = [...matching, ...systemOnly];

  if (all.length === 0) {
    // No lever mapped — surface honestly rather than fabricate
    return [
      {
        family: {
          family: 'no-feasible-lever',
          factorKeys: [factor],
          actuator: 'cs',
          description: `No feasible lever yet for factor "${factor}".`,
          playbookIds: [],
        },
        verdict: {
          status: 'infeasible',
          lever: {
            family: 'no-feasible-lever',
            actuator: 'cs',
            description: `No feasible lever yet for factor "${factor}".`,
          },
          why: `Factor "${factor}" has no mapped lever family in the current registry.`,
        },
      },
    ];
  }

  return all.map((family) => {
    const verdict = buildVerdict(family);
    const primaryPlaybook = family.playbookIds
      .map((id) => SEED_PLAYBOOKS.find((p) => p.id === id))
      .find((p): p is Playbook => p != null && !isPlaybookBlocked(p));

    return {
      family,
      verdict,
      primaryPlaybookId: primaryPlaybook?.id,
    };
  });
}
