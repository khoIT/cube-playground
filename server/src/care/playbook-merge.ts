/**
 * Seed ⊕ override merge — the single playbook view every surface reads.
 *
 * For a game: start from the 21 seeds, apply per-game override rows (override wins
 * per field), append net-new CS-authored playbooks, then resolve each against the
 * game's live member set (availability) and compile its threshold rule to a cohort
 * predicate where possible. Calibration results (when present) resolve percentile
 * rules to concrete cutoffs.
 */

import { randomUUID } from 'node:crypto';
import { SEED_PLAYBOOKS, type Playbook, type PlaybookPriority } from './playbook-registry.js';
import { listOverrides, type CarePlaybookOverride } from './care-playbooks-store.js';
import {
  resolveAvailability,
  type AvailabilityStatus,
} from './availability.js';
import {
  compileRule,
  type CalibrationResult,
  type EvalMode,
} from './threshold-rule.js';
import type { PredicateNode } from '../types/predicate-tree.js';

export type PlaybookSource = 'seed' | 'override' | 'custom';

export interface ResolvedPlaybook extends Playbook {
  source: PlaybookSource;
  /** Override row id when source !== 'seed'. */
  overrideId?: string;
  enabled: boolean;
  availability: AvailabilityStatus;
  evalMode: EvalMode;
  /**
   * Effective cohort predicate: the compiled threshold rule ANDed with the
   * optional supplemental filter. null for trigger rules or uncalibrated
   * percentiles with no supplemental filter.
   */
  predicate: PredicateNode | null;
  /** The raw supplemental AND/OR filter (for the Builder to re-edit); undefined when unused. */
  supplementalPredicate?: PredicateNode;
  /** Reason predicate is null on a membership rule (e.g. awaiting calibration). */
  compileReason?: string;
  /** True once a calibration cutoff backs the threshold; false = starter estimate. */
  calibrated: boolean;
}

const GROUP_TO_NHOM: Record<Playbook['group'], Playbook['nhom']> = {
  payment: 1,
  ingame: 2,
  churn: 3,
  event: 4,
};

/** Apply an override's set fields over a seed (or onto an empty base for net-new). */
function applyOverride(base: Playbook | undefined, ov: CarePlaybookOverride): Playbook {
  const b = base ?? {
    id: ov.baseId ?? ov.id,
    nhom: GROUP_TO_NHOM[ov.group ?? 'event'],
    group: ov.group ?? 'event',
    name: ov.name ?? 'Custom playbook',
    priority: ov.priority ?? 'tb',
    dataRequirements: ov.dataRequirements ?? [],
    condition: ov.condition ?? { kind: 'abs', member: '', op: 'gte', value: 0 },
    watchedMetric: ov.watchedMetric ?? { member: '', label: '' },
    action: ov.action ?? { text: '', channels: [] },
  } as Playbook;

  return {
    ...b,
    name: ov.name ?? b.name,
    group: ov.group ?? b.group,
    priority: ov.priority ?? b.priority,
    dataRequirements: ov.dataRequirements ?? b.dataRequirements,
    condition: ov.condition ?? b.condition,
    watchedMetric: ov.watchedMetric ?? b.watchedMetric,
    action: ov.action ?? b.action,
  };
}

export interface MergeOptions {
  /** Per-playbook-id calibration results (keyed by effective playbook id). */
  calibration?: Record<string, CalibrationResult>;
}

/**
 * Merge seeds + a game's overrides into the resolved view.
 * `members` is the game's live logical member set (from getGameMembers).
 */
export function mergePlaybooks(
  gameId: string,
  members: Set<string>,
  overrides: CarePlaybookOverride[] = listOverrides(gameId),
  opts: MergeOptions = {},
): ResolvedPlaybook[] {
  const calibration = opts.calibration ?? {};

  // Index overrides: seed-overrides by base_id, net-new collected separately.
  const overrideByBase = new Map<string, CarePlaybookOverride>();
  const netNew: CarePlaybookOverride[] = [];
  for (const ov of overrides) {
    if (ov.baseId) overrideByBase.set(ov.baseId, ov);
    else netNew.push(ov);
  }

  const resolved: ResolvedPlaybook[] = [];

  // Seeds (optionally overridden).
  for (const seed of SEED_PLAYBOOKS) {
    const ov = overrideByBase.get(seed.id);
    const merged = ov ? applyOverride(seed, ov) : seed;
    resolved.push(
      finalize(merged, {
        source: ov ? 'override' : 'seed',
        overrideId: ov?.id,
        enabled: ov ? ov.enabled : true,
        members,
        calibration: calibration[merged.id],
        supplementalPredicate: ov?.supplementalPredicate,
      }),
    );
  }

  // Net-new CS-authored playbooks.
  for (const ov of netNew) {
    const merged = applyOverride(undefined, ov);
    resolved.push(
      finalize(merged, {
        source: 'custom',
        overrideId: ov.id,
        enabled: ov.enabled,
        members,
        calibration: calibration[merged.id],
        supplementalPredicate: ov.supplementalPredicate,
      }),
    );
  }

  return resolved;
}

/**
 * Lightweight {effective playbook id → priority/name} map for a game, WITHOUT a
 * /meta round-trip — used by the action queue to rank cases by priority. Applies
 * seed-overrides and includes net-new playbooks.
 */
export function playbookMetaMap(
  gameId: string,
  overrides: CarePlaybookOverride[] = listOverrides(gameId),
): Record<string, { priority: PlaybookPriority; name: string; group: string }> {
  const overrideByBase = new Map<string, CarePlaybookOverride>();
  const netNew: CarePlaybookOverride[] = [];
  for (const ov of overrides) {
    if (ov.baseId) overrideByBase.set(ov.baseId, ov);
    else netNew.push(ov);
  }
  const map: Record<string, { priority: PlaybookPriority; name: string; group: string }> = {};
  for (const seed of SEED_PLAYBOOKS) {
    const ov = overrideByBase.get(seed.id);
    map[seed.id] = {
      priority: ov?.priority ?? seed.priority,
      name: ov?.name ?? seed.name,
      group: ov?.group ?? seed.group,
    };
  }
  for (const ov of netNew) {
    map[ov.id] = {
      priority: ov.priority ?? 'tb',
      name: ov.name ?? 'Custom playbook',
      group: ov.group ?? 'event',
    };
  }
  return map;
}

/** Fallback SLA when a playbook declares none — mirrors the CS console default. */
const DEFAULT_SLA_MINUTES = 1440;

/**
 * Per-playbook SLA window in minutes for a game (seed ⊕ override), independent
 * of live availability. Lets a count-only surface compute SLA breaches from the
 * static registry without a Cube /meta round-trip.
 */
export function playbookSlaMap(
  gameId: string,
  overrides: CarePlaybookOverride[] = listOverrides(gameId),
): Record<string, number> {
  const overrideByBase = new Map<string, CarePlaybookOverride>();
  const netNew: CarePlaybookOverride[] = [];
  for (const ov of overrides) {
    if (ov.baseId) overrideByBase.set(ov.baseId, ov);
    else netNew.push(ov);
  }
  const map: Record<string, number> = {};
  for (const seed of SEED_PLAYBOOKS) {
    const ov = overrideByBase.get(seed.id);
    map[seed.id] = ov?.action?.slaMinutes ?? seed.action.slaMinutes ?? DEFAULT_SLA_MINUTES;
  }
  for (const ov of netNew) {
    map[ov.id] = ov.action?.slaMinutes ?? DEFAULT_SLA_MINUTES;
  }
  return map;
}

const PRIORITY_RANK: Record<PlaybookPriority, number> = { cao: 0, tb: 1, thap: 2 };
export function priorityRank(p: PlaybookPriority): number {
  return PRIORITY_RANK[p] ?? 3;
}

/**
 * Combine the compiled threshold predicate with the optional supplemental
 * filter. Both present → AND group; one present → that one; neither → null.
 */
function combinePredicates(
  base: PredicateNode | null,
  supplemental?: PredicateNode,
): PredicateNode | null {
  if (base && supplemental) {
    return { kind: 'group', id: randomUUID(), op: 'AND', children: [base, supplemental] };
  }
  return base ?? supplemental ?? null;
}

function finalize(
  pb: Playbook,
  o: {
    source: PlaybookSource;
    overrideId?: string;
    enabled: boolean;
    members: Set<string>;
    calibration?: CalibrationResult;
    supplementalPredicate?: PredicateNode;
  },
): ResolvedPlaybook {
  const availability = resolveAvailability(pb, o.members);
  const compiled = compileRule(pb.condition, o.calibration);
  return {
    ...pb,
    source: o.source,
    overrideId: o.overrideId,
    enabled: o.enabled,
    availability,
    evalMode: compiled.evalMode,
    predicate: combinePredicates(compiled.predicate, o.supplementalPredicate),
    supplementalPredicate: o.supplementalPredicate,
    compileReason: compiled.reason,
    calibrated: o.calibration?.cutoff != null,
  };
}
