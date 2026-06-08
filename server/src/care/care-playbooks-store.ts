/**
 * CRUD over the `care_playbooks` override/addition table.
 *
 * Rows are either an override of a seed (base_id set) or a net-new CS-authored
 * playbook (base_id null). Phase-0 only reads these (merge layer); Phase-6
 * authoring uses the create/update/disable mutators.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';
import type { PlaybookGroup, PlaybookPriority, WatchedMetric, PlaybookAction } from './playbook-registry.js';
import type { ThresholdRule } from './threshold-rule.js';

export interface CarePlaybookRow {
  id: string;
  game_id: string;
  base_id: string | null;
  name: string | null;
  group_name: PlaybookGroup | null;
  priority: PlaybookPriority | null;
  condition_json: string | null;
  watched_metric_json: string | null;
  action_json: string | null;
  data_requirements_json: string | null;
  enabled: number;
  owner: string | null;
  created_at: string;
  updated_at: string;
}

/** Decoded override — JSON columns parsed; only set fields are present. */
export interface CarePlaybookOverride {
  id: string;
  gameId: string;
  baseId: string | null;
  name?: string;
  group?: PlaybookGroup;
  priority?: PlaybookPriority;
  condition?: ThresholdRule;
  watchedMetric?: WatchedMetric;
  action?: PlaybookAction;
  dataRequirements?: string[];
  enabled: boolean;
  owner?: string;
  createdAt: string;
  updatedAt: string;
}

function parse<T>(json: string | null): T | undefined {
  if (json == null) return undefined;
  try {
    return JSON.parse(json) as T;
  } catch {
    // Corrupt override column → fall back to the seed value (fail-soft, never
    // crash the monitor), but make the bad row observable.
    console.warn('[care-playbooks] unparseable override JSON column — falling back to seed');
    return undefined;
  }
}

export function rowToOverride(row: CarePlaybookRow): CarePlaybookOverride {
  return {
    id: row.id,
    gameId: row.game_id,
    baseId: row.base_id,
    name: row.name ?? undefined,
    group: row.group_name ?? undefined,
    priority: row.priority ?? undefined,
    condition: parse<ThresholdRule>(row.condition_json),
    watchedMetric: parse<WatchedMetric>(row.watched_metric_json),
    action: parse<PlaybookAction>(row.action_json),
    dataRequirements: parse<string[]>(row.data_requirements_json),
    enabled: row.enabled === 1,
    owner: row.owner ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** All override rows for a game (overrides + net-new), decoded. */
export function listOverrides(gameId: string): CarePlaybookOverride[] {
  const rows = getDb()
    .prepare('SELECT * FROM care_playbooks WHERE game_id = ? ORDER BY created_at')
    .all(gameId) as CarePlaybookRow[];
  return rows.map(rowToOverride);
}

export function getOverride(id: string): CarePlaybookOverride | undefined {
  const row = getDb().prepare('SELECT * FROM care_playbooks WHERE id = ?').get(id) as
    | CarePlaybookRow
    | undefined;
  return row ? rowToOverride(row) : undefined;
}

// ── Mutators (Phase 6 authoring) ─────────────────────────────────────────────

export interface CarePlaybookWrite {
  gameId: string;
  baseId?: string | null; // seed id being overridden; null/undefined = net-new
  name?: string;
  group?: PlaybookGroup;
  priority?: PlaybookPriority;
  condition?: ThresholdRule;
  watchedMetric?: WatchedMetric;
  action?: PlaybookAction;
  dataRequirements?: string[];
  enabled?: boolean;
  owner?: string;
}

const jstr = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(v));

/**
 * Create an override (base_id set) or net-new (base_id null) row. Overrides are
 * upserted per (game, base_id) so a second edit of the same seed updates rather
 * than collides with the unique index. Seeds themselves are never stored, so
 * they can't be created/deleted here — only overridden.
 */
export function createOverride(w: CarePlaybookWrite): CarePlaybookOverride {
  const db = getDb();
  const now = new Date().toISOString();
  const enabled = w.enabled === false ? 0 : 1;

  if (w.baseId) {
    const existing = db
      .prepare('SELECT id FROM care_playbooks WHERE game_id = ? AND base_id = ?')
      .get(w.gameId, w.baseId) as { id: string } | undefined;
    if (existing) return updateOverride(existing.id, w)!;
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO care_playbooks
       (id, game_id, base_id, name, group_name, priority, condition_json,
        watched_metric_json, action_json, data_requirements_json, enabled, owner, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, w.gameId, w.baseId ?? null, w.name ?? null, w.group ?? null, w.priority ?? null,
    jstr(w.condition), jstr(w.watchedMetric), jstr(w.action), jstr(w.dataRequirements),
    enabled, w.owner ?? null, now, now,
  );
  return getOverride(id)!;
}

/** Patch an existing override row (only provided fields change). */
export function updateOverride(id: string, w: Partial<CarePlaybookWrite>): CarePlaybookOverride | undefined {
  const cur = getOverride(id);
  if (!cur) return undefined;
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [new Date().toISOString()];
  const push = (col: string, val: unknown) => { sets.push(`${col} = ?`); params.push(val); };

  if (w.name !== undefined) push('name', w.name);
  if (w.group !== undefined) push('group_name', w.group);
  if (w.priority !== undefined) push('priority', w.priority);
  if (w.condition !== undefined) push('condition_json', jstr(w.condition));
  if (w.watchedMetric !== undefined) push('watched_metric_json', jstr(w.watchedMetric));
  if (w.action !== undefined) push('action_json', jstr(w.action));
  if (w.dataRequirements !== undefined) push('data_requirements_json', jstr(w.dataRequirements));
  if (w.enabled !== undefined) push('enabled', w.enabled ? 1 : 0);
  if (w.owner !== undefined) push('owner', w.owner);

  getDb().prepare(`UPDATE care_playbooks SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  return getOverride(id);
}

/** Delete an override/net-new row. Seeds aren't stored here, so they're unaffected. */
export function deleteOverride(id: string): boolean {
  const res = getDb().prepare('DELETE FROM care_playbooks WHERE id = ?').run(id);
  return res.changes > 0;
}
