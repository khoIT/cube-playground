/**
 * Lens 7 — Lifecycle / Cohort (lazy).
 *
 * Segments users by tenure band (lifecycle_stage from mf_users) and measures
 * the paying rate per band. A segment heavily skewed toward the "churned" or
 * "dormant" bands with low paying rates signals lifespan deterioration.
 *
 * Tenure bands from mf_users.lifecycle_stage:
 *   active_today → active_7d → active_30d → dormant → churned
 *
 * Lazy: only executed when caller includes lens id 7.
 * Source: mf_users (lifecycle_stage dim + paying_users / user_count measures).
 */

import type { WorkspaceCtx } from '../../services/cube-client.js';
import type { LensResult, ScopeRef } from '../diagnosis-types.js';
import { readWithProvenance, type CubeReaderFn } from '../cube-read.js';
import { scopeToFilters, gameIdFromScope } from '../scope-helpers.js';

/** Stages ordered from most active to churned. */
const LIFECYCLE_STAGES = ['active_today', 'active_7d', 'active_30d', 'dormant', 'churned'];

interface LifecycleLensInput {
  scope: ScopeRef;
  asOf: Date;
}

export async function runLens07Lifecycle(
  input: LifecycleLensInput,
  ctx: WorkspaceCtx,
  reader?: CubeReaderFn,
): Promise<LensResult> {
  const gameId = gameIdFromScope(input.scope);
  const scopeFilters = scopeToFilters(input.scope);

  try {
    // Fetch user_count + paying_users broken down by lifecycle_stage.
    const result = await readWithProvenance(
      {
        measures: ['mf_users.user_count', 'mf_users.paying_users'],
        dimensions: ['mf_users.lifecycle_stage'],
        filters: scopeFilters,
      },
      ctx,
      `mf_users / ${gameId} — lifecycle breakdown`,
      reader,
    );

    if (result.rows.length === 0) {
      return inconclusiveResult('No lifecycle data returned');
    }

    // Build a band map: stage → { users, payers }.
    const bands: Record<string, { users: number; payers: number }> = {};
    let totalUsers = 0;
    let churnedOrDormant = 0;

    for (const row of result.rows) {
      const stage = String(row['mf_users.lifecycle_stage'] ?? 'unknown');
      const users = Number(row['mf_users.user_count'] ?? 0);
      const payers = Number(row['mf_users.paying_users'] ?? 0);
      bands[stage] = { users, payers };
      totalUsers += users;
      if (stage === 'churned' || stage === 'dormant') churnedOrDormant += users;
    }

    if (totalUsers === 0) return inconclusiveResult('Empty cohort');

    const churnedPct = (churnedOrDormant / totalUsers) * 100;
    // Weak when >60% of the segment is dormant/churned.
    const isWeak = churnedPct > 60;

    return {
      id: 7,
      name: 'Lifecycle / Cohort',
      verdict: isWeak ? 'weak' : 'ok',
      factor: 'lifespan',
      inputs: { bands, totalUsers, churnedOrDormant, churnedPct: Math.round(churnedPct * 10) / 10 },
      method: `${Math.round(churnedPct)}% of segment is dormant/churned (${churnedOrDormant}/${totalUsers} users)`,
      provenance: result.provenance,
    };
  } catch (err) {
    return inconclusiveResult((err as Error).message);
  }
}

function inconclusiveResult(reason: string): LensResult {
  return {
    id: 7,
    name: 'Lifecycle / Cohort',
    verdict: 'inconclusive',
    inputs: { reason },
    method: `Inconclusive: ${reason}`,
    provenance: { measures: [], source: 'lifecycle — unavailable' },
  };
}
