/**
 * Catalog referential-integrity helpers — does a typed `<namespace>/<id>` ref
 * actually point at something that exists?
 *
 *   business_metrics/<id> → present in the metric registry?
 *   segments/<id>         → present in the segments table?
 *   data_model/<member>   → grammar-only here (live /meta membership is the
 *                           scheduled metric-coverage check, not a sync lookup).
 *   unparseable / bare    → treated as NOT dangling (legacy primary refs may be
 *                           a bare cube member, e.g. `mf_users.country`).
 *
 * Shared so the glossary write path (reject dangling refs on POST/PUT) and the
 * boot/Settings audit use one definition of "dangling" — no asymmetric trust.
 */

import { getDb } from '../db/sqlite.js';
import { getById as getMetricById } from './business-metrics-loader.js';
import { parseRef } from './trust-mapping.js';

/** True when a typed ref points at a target that does not exist. */
export function isRefDangling(ref: string): boolean {
  const parsed = parseRef(ref);
  if (!parsed) return false; // untyped/legacy ref — grammar-only, not existence-checked
  if (parsed.namespace === 'business_metrics') return !getMetricById(parsed.id);
  if (parsed.namespace === 'segments') {
    return !getDb().prepare('SELECT 1 FROM segments WHERE id = ?').get(parsed.id);
  }
  return false; // data_model — covered by the live /meta coverage check
}

/** Returns the subset of refs whose target does not exist. Skips null/empty. */
export function danglingRefs(refs: Array<string | null | undefined>): string[] {
  const bad: string[] = [];
  for (const ref of refs) {
    if (ref && isRefDangling(ref)) bad.push(ref);
  }
  return bad;
}

export type RefSlot = 'primary' | 'secondary';

export interface DanglingGlossaryRef {
  termId: string;
  label: string;
  ref: string;
  slot: RefSlot;
}

interface GlossaryRefRow {
  id: string;
  label: string;
  primary_catalog_id: string | null;
  secondary_catalog_ids: string | null;
}

/**
 * Scan every glossary term's primary + secondary catalog refs and return the
 * ones that don't resolve. Drives the boot warning and the Settings panel so a
 * dead chat-chip link (glossary term → non-existent metric) is surfaced before
 * a user clicks it.
 */
export function auditGlossaryRefs(): DanglingGlossaryRef[] {
  const rows = getDb()
    .prepare('SELECT id, label, primary_catalog_id, secondary_catalog_ids FROM glossary_terms')
    .all() as GlossaryRefRow[];

  const out: DanglingGlossaryRef[] = [];
  for (const row of rows) {
    if (row.primary_catalog_id && isRefDangling(row.primary_catalog_id)) {
      out.push({ termId: row.id, label: row.label, ref: row.primary_catalog_id, slot: 'primary' });
    }
    if (row.secondary_catalog_ids) {
      let refs: unknown;
      try {
        refs = JSON.parse(row.secondary_catalog_ids);
      } catch {
        refs = [];
      }
      if (Array.isArray(refs)) {
        for (const ref of refs) {
          if (typeof ref === 'string' && isRefDangling(ref)) {
            out.push({ termId: row.id, label: row.label, ref, slot: 'secondary' });
          }
        }
      }
    }
  }
  return out;
}
