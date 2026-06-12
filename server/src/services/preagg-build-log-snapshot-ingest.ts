/**
 * Worker-log snapshots bridging the build trigger and the sweep collector.
 *
 * A triggered build force-recreates the worker container twice (scope, then
 * restore), and each recreate DESTROYS the container's log history — including
 * the build window's per-partition lines the collector needs for sweep
 * history. Before each recreate the trigger dumps the worker's timestamped
 * logs into a shared directory (writeBuildLogSnapshot, or the manual
 * trigger-preagg-build.sh's equivalent dump); the collector calls
 * consumeBuildLogSnapshots() each pass to fold those lines back into its
 * normal parse, then deletes the files (consume-once).
 *
 * The in-process trigger and the collector share one process, so the dir is
 * plain local tmp; the manual script shares it with a host-run gateway.
 */

import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_DIR = '/tmp/cube-playground-preagg-log-snapshots';

/** Same env override the trigger script honors — keep the two in sync. */
function snapshotDir(): string {
  return process.env.PREAGG_BUILD_LOG_SNAPSHOT_DIR ?? DEFAULT_DIR;
}

/**
 * Read and delete all pending snapshot files, oldest first (filenames are
 * epoch-prefixed: `<epoch>-<game>-<label>.log`). Returns their log lines in
 * chronological file order; [] when the dir is absent or empty. A file that
 * can't be read is skipped and left in place for the next pass.
 */
/**
 * Persist worker log lines for the collector's next pass. Filename follows the
 * trigger script's `<epoch>-<game>-<label>.log` convention so chronological
 * sort interleaves both producers. Errors are swallowed — losing a snapshot
 * degrades sweep-history detail, never the build itself.
 */
export function writeBuildLogSnapshot(lines: string[], game: string, label: string): void {
  if (!lines.length) return;
  try {
    mkdirSync(snapshotDir(), { recursive: true });
    const epochSec = Math.floor(Date.now() / 1000);
    writeFileSync(join(snapshotDir(), `${epochSec}-${game}-${label}.log`), lines.join('\n') + '\n', 'utf8');
  } catch {
    // tmp unwritable — skip; the collector simply misses this window's lines.
  }
}

export function consumeBuildLogSnapshots(): string[] {
  let files: string[];
  try {
    files = readdirSync(snapshotDir()).filter((f) => f.endsWith('.log')).sort();
  } catch {
    return []; // dir absent — no trigger has run on this host
  }

  const lines: string[] = [];
  for (const f of files) {
    const path = join(snapshotDir(), f);
    try {
      const content = readFileSync(path, 'utf8');
      unlinkSync(path);
      for (const raw of content.split('\n')) {
        const line = raw.trim();
        if (line) lines.push(line);
      }
    } catch {
      // Unreadable mid-write or permission hiccup — retry on the next pass.
    }
  }
  return lines;
}
