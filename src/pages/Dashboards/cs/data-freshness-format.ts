/**
 * Shared helpers for the CS "data as-of" labels.
 *
 * The freshness map is keyed by logical cube; a playbook reads its first data
 * requirement's cube, so that is the cube whose as-of date stamps the row.
 */

/** Logical cube a playbook's cohort query reads (its first data requirement). */
export function primaryCubeOf(dataRequirements: string[]): string | null {
  return dataRequirements[0]?.split('.')[0] ?? null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' → 'D MMM YYYY' (e.g. '2026-05-01' → '1 May 2026'); passthrough on parse miss. */
export function formatAsOf(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * Distinct as-of dates across the cubes backing `playbooks` (skips unavailable
 * rows — they query nothing). Returns ascending ISO strings, for the header to
 * show a single date or a stale→fresh range.
 */
export function distinctAsOf(
  playbooks: { availability: string; dataRequirements: string[] }[],
  asOfByCube: Record<string, string>,
): string[] {
  const set = new Set<string>();
  for (const p of playbooks) {
    if (p.availability === 'unavailable') continue;
    const cube = primaryCubeOf(p.dataRequirements);
    const iso = cube ? asOfByCube[cube] : undefined;
    if (iso) set.add(iso);
  }
  return [...set].sort();
}
