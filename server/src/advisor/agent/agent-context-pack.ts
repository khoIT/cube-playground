/**
 * Omniscient context pack — the curated knowledge the advisor agent gets up
 * front, beyond the base "Guided Drive" prompt. This is the "more omniscient
 * than the chat agent" part: the chat agent has no goal-tree / lever-map /
 * playbook context.
 *
 * Injection vs retrieval split (Q-A3): small, STABLE, high-value structure is
 * injected here (goal trees, lever taxonomy, playbook index, the active scope).
 * Large/volatile detail (the live data-model catalog, segment size, query rows)
 * is pulled on demand via cube_meta / cube_query / diagnose. The pack is PURE —
 * no startup I/O — so a session can be created even on a host without Cube.
 *
 * Keep the serialized pack under the budget below; the size is asserted in tests.
 */

import { buildRevenueGoalTree, buildEngagementGoalTree } from '../goal-tree.js';
import { listLeverFamilies } from '../lever-map.js';
import { SEED_PLAYBOOKS } from '../../care/playbook-registry.js';
import type { ScopeRef } from '../diagnosis-types.js';

/** Soft budget for the injected pack (characters). Tests assert we stay under. */
export const CONTEXT_PACK_MAX_CHARS = 6000;

const NULL_REVENUE = { payers: null, arppu: null, lifespan: null };
const NULL_ENGAGEMENT = { sessionFreq: null, sessionLength: null, lifespan: null };

function goalTreeLines(): string {
  const revenue = buildRevenueGoalTree(NULL_REVENUE, NULL_REVENUE);
  const engagement = buildEngagementGoalTree(NULL_ENGAGEMENT, NULL_ENGAGEMENT);
  const fmt = (label: string, factors: { key: string; label: string }[]): string =>
    `${label}: ${factors.map((f) => `${f.label} (${f.key})`).join(' × ')}`;
  return [fmt('Revenue', revenue.factors), fmt('Engagement', engagement.factors)].join('\n');
}

function leverLines(): string {
  return listLeverFamilies()
    .map(
      (f) =>
        `• ${f.family} → factors [${f.factorKeys.join(', ')}], ${f.actuator === 'cs' ? 'CS-deliverable now' : 'needs infra (substitute exists)'}`,
    )
    .join('\n');
}

function playbookLines(): string {
  return SEED_PLAYBOOKS.map((p) => `${p.id} ${p.name} [${p.group}]`).join('; ');
}

function describeScope(scope: ScopeRef): string {
  return scope.kind === 'segment'
    ? `segment ${scope.segmentId} in ${scope.gameId}`
    : `whole player base of ${scope.gameId}`;
}

/**
 * Build the injected context pack appended to the base system prompt. Trims to
 * the budget defensively (the playbook index is the most likely to grow).
 */
export function buildContextPack(scope: ScopeRef): string {
  const pack = [
    '— Reference knowledge for this investigation —',
    '',
    `Active scope: ${describeScope(scope)}.`,
    '',
    'Goal decompositions (where to look for the Opportunity):',
    goalTreeLines(),
    '',
    'Lever families (the Levers you can propose — CS-deliverable ones are runnable today):',
    leverLines(),
    '',
    'VIP-Care playbook index (CS work-queue templates a lever can route to):',
    playbookLines(),
    '',
    'You do NOT have the live data catalog or the segment size in this prompt — ' +
      'call cube_meta to see available data, diagnose to get the cohort size and ' +
      'weak factors, and cube_query for any specific aggregate.',
  ].join('\n');
  return pack.length > CONTEXT_PACK_MAX_CHARS ? `${pack.slice(0, CONTEXT_PACK_MAX_CHARS)}\n…(trimmed)` : pack;
}
