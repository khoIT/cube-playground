import { deleteSchemaWrite } from '../../../api';
import { getPref, setPref, removePref } from '../../../../../hooks/server-prefs-store';

/**
 * Registry of measures the live preview has committed to disk but the user
 * has NOT yet submitted (or explicitly discarded). Persisted server-side (per
 * owner) via the preferences store with a synchronous localStorage mirror, so
 * it survives tab refreshes/navigations and is device-portable — on the next
 * wizard mount we can sweep stale entries and delete the orphaned YAML on disk.
 *
 * Lifecycle:
 *   - useTestRun adds an entry after a successful schema-write.
 *   - useTestRun removes the entry when the draft identity changes
 *     (auto-discards the prior file).
 *   - TestRunBody.handleSubmit removes the entry on success (the file is
 *     now permanent).
 *   - NewMetricPage.handleDiscard iterates ALL entries and DELETEs each.
 *   - NewMetricPage on mount sweeps entries that don't match the current
 *     draft's (cube, name) — those are leftovers from a session the user
 *     closed without explicit Discard or Submit.
 */

const STORAGE_KEY = 'gds-cube:wizard-pending-commits';

export type PendingEntry = {
  cubeName: string;
  measureName: string;
};

function readAll(): PendingEntry[] {
  try {
    const raw = getPref(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PendingEntry =>
        e && typeof e.cubeName === 'string' && typeof e.measureName === 'string',
    );
  } catch {
    return [];
  }
}

function writeAll(entries: PendingEntry[]): void {
  // Best-effort persistence — worst case is orphaned on-disk YAML the user can
  // still discard manually.
  setPref(STORAGE_KEY, JSON.stringify(entries));
}

function sameIdentity(a: PendingEntry, b: PendingEntry): boolean {
  return a.cubeName === b.cubeName && a.measureName === b.measureName;
}

export function listPending(): PendingEntry[] {
  return readAll();
}

export function addPending(entry: PendingEntry): void {
  const current = readAll();
  if (current.some((e) => sameIdentity(e, entry))) return;
  writeAll([...current, entry]);
}

export function removePending(entry: PendingEntry): void {
  const current = readAll();
  const next = current.filter((e) => !sameIdentity(e, entry));
  if (next.length !== current.length) writeAll(next);
}

export function clearPending(): void {
  removePref(STORAGE_KEY);
}

/**
 * Best-effort DELETE for every entry in the registry, then clear it.
 * Used by the wizard's Discard button.
 */
export async function discardAllPending(): Promise<void> {
  const entries = readAll();
  await Promise.allSettled(entries.map((e) => deleteSchemaWrite(e)));
  clearPending();
}

/**
 * Sweep entries that don't match `keep` — typically the current draft's
 * identity — and DELETE them. Used on wizard mount to clean up orphans
 * left behind by a session that was closed without Discard or Submit.
 */
export async function sweepStale(keep: PendingEntry | null): Promise<void> {
  const entries = readAll();
  const stale = keep
    ? entries.filter((e) => !sameIdentity(e, keep))
    : entries;
  if (stale.length === 0) return;
  await Promise.allSettled(stale.map((e) => deleteSchemaWrite(e)));
  if (keep && entries.some((e) => sameIdentity(e, keep))) {
    writeAll([keep]);
  } else {
    clearPending();
  }
}
