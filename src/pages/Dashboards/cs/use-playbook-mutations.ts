/**
 * use-playbook-mutations — POST / PATCH / DELETE hooks for the Playbook Builder.
 *
 * POST  /api/care/playbooks?game=<id>  — create override (base_id set) or net-new (base_id null).
 * PATCH /api/care/playbooks/:id       — update an existing override row.
 * DELETE /api/care/playbooks/:id      — remove an override row (reverts a seed to canonical).
 *
 * All three calls are fire-and-forget promises; callers await them and handle errors inline.
 * No React state lives here — the callers (playbook-builder) manage saving/error states.
 *
 * RBAC note: the server enforces editor/admin on every mutation. Clients should
 * hide write actions for viewers (useAuthUser().role === 'viewer'), but the server
 * is the authoritative gate.
 */

import { apiFetch } from '../../../api/api-client';
import type { ThresholdRule } from '../../../types/threshold-rule';
import type { PredicateNode } from '../../../types/segment-api';

// ── Shared field types ────────────────────────────────────────────────────────

export type PlaybookGroupInput = 'payment' | 'ingame' | 'churn' | 'event';
export type PlaybookPriorityInput = 'cao' | 'tb' | 'thap';

export interface WatchedMetricInput {
  member: string;
  label: string;
  kpiTarget?: string;
}

export interface ActionInput {
  text: string;
  channels: string[];
  slaMinutes?: number;
}

// ── POST body ─────────────────────────────────────────────────────────────────

export interface CreatePlaybookInput {
  /** base_id set = override a seed; null = net-new custom playbook. */
  base_id: string | null;
  name: string;
  group: PlaybookGroupInput;
  priority: PlaybookPriorityInput;
  condition: ThresholdRule;
  watchedMetric: WatchedMetricInput;
  action: ActionInput;
  dataRequirements: string[];
  /** Optional AND/OR filter ANDed onto the threshold condition; null clears it. */
  supplementalPredicate?: PredicateNode | null;
  enabled?: boolean;
}

// ── PATCH body ────────────────────────────────────────────────────────────────

export type UpdatePlaybookInput = Partial<Omit<CreatePlaybookInput, 'base_id'>>;

// ── Response shape (camelCase, from server) ────────────────────────────────────

export interface CarePlaybookOverride {
  id: string;
  gameId: string;
  baseId: string | null;
  name: string;
  group: PlaybookGroupInput;
  priority: PlaybookPriorityInput;
  condition: ThresholdRule;
  watchedMetric: WatchedMetricInput;
  action: ActionInput;
  dataRequirements: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Functions ─────────────────────────────────────────────────────────────────

/**
 * Create a playbook override (base_id = seed id) or a net-new playbook (base_id = null).
 * Returns the created CarePlaybookOverride row.
 */
export async function createPlaybook(
  gameId: string,
  input: CreatePlaybookInput,
  signal?: AbortSignal,
): Promise<CarePlaybookOverride> {
  return apiFetch<CarePlaybookOverride>('/api/care/playbooks', {
    method: 'POST',
    query: { game: gameId },
    body: input,
    signal,
  });
}

/**
 * Update an existing override row (partial update).
 * `id` must be the override row id (not a seed id).
 */
export async function updatePlaybook(
  id: string,
  input: UpdatePlaybookInput,
  signal?: AbortSignal,
): Promise<CarePlaybookOverride> {
  return apiFetch<CarePlaybookOverride>(`/api/care/playbooks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
    signal,
  });
}

/**
 * Delete an override row. Reverts a seed-based override to the canonical seed config.
 * Returns void (server sends 204).
 */
export async function deletePlaybook(id: string, signal?: AbortSignal): Promise<void> {
  await apiFetch<void>(`/api/care/playbooks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal,
  });
}
