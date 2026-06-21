/**
 * Pure (no-DB, no-fs) diff of two Cube YAML texts for the Model Audit UI.
 *
 * Produces two complementary views the page renders side by side:
 *   - a STRUCTURED field diff (primary_key changed X→Y, measure added/removed,
 *     join/rollup added/removed) computed from the parsed model, so the UI can
 *     say what changed, not just which lines moved;
 *   - a line-oriented UNIFIED text diff (LCS-based, no external dependency) for
 *     the raw before/after.
 *
 * Dev cubes use bare names (`recharge`); oracle cubes are schema-prefixed
 * (`cfm_vn__recharge`). Within a file that declares several cubes we select the
 * one whose name matches the requested logical entity, prefix-tolerant.
 */

import yaml from 'js-yaml';

export interface MeasureShape {
  name: string;
  type?: string;
}

/** The minimal comparable shape extracted from one cube definition. */
export interface CubeShape {
  cubeName: string;
  sqlTable: string | null;
  primaryKeys: string[];
  measures: MeasureShape[];
  dimensions: string[];
  joins: string[];
  rollups: string[];
}

export interface FieldChange {
  /** pk | measure | join | rollup | sqlTable */
  field: string;
  kind: 'added' | 'removed' | 'changed';
  name?: string;
  before: string | null;
  after: string | null;
}

export interface StructuredDiff {
  /** true when one side had no matching cube (dev-only or prod-only). */
  devPresent: boolean;
  prodPresent: boolean;
  changes: FieldChange[];
}

export interface UnifiedDiffLine {
  kind: 'ctx' | 'add' | 'del';
  text: string;
}

export interface TextDiff {
  lines: UnifiedDiffLine[];
  added: number;
  removed: number;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Strip a leading `<anything>__` so prefixed oracle names match bare dev names. */
function bareName(name: string): string {
  const i = name.indexOf('__');
  return i === -1 ? name : name.slice(i + 2);
}

/**
 * Parse a YAML file text and extract the cube whose (prefix-stripped) name
 * equals `logical`. Returns null when the file fails to parse or has no match.
 */
export function extractCubeShape(text: string, logical: string): CubeShape | null {
  let doc: { cubes?: unknown[] } | null;
  try {
    doc = yaml.load(text) as { cubes?: unknown[] } | null;
  } catch {
    return null;
  }
  const cubes = asArray<Record<string, unknown>>(doc?.cubes);
  const cube =
    cubes.find((c) => bareName(String(c.name ?? '')) === logical) ??
    (cubes.length === 1 ? cubes[0] : undefined);
  if (!cube) return null;

  const dims = asArray<Record<string, unknown>>(cube.dimensions);
  const measures = asArray<Record<string, unknown>>(cube.measures);
  const joins = asArray<Record<string, unknown>>(cube.joins);
  const preAggs = asArray<Record<string, unknown>>(cube.pre_aggregations);
  return {
    cubeName: String(cube.name ?? '(unnamed)'),
    sqlTable: (cube.sql_table as string) ?? null,
    primaryKeys: dims.filter((d) => d.primary_key === true).map((d) => String(d.name)),
    measures: measures.map((m) => ({ name: String(m.name), type: m.type as string | undefined })),
    dimensions: dims.map((d) => String(d.name)),
    joins: joins.map((j) => String(j.name)),
    rollups: preAggs.map((p) => String(p.name)),
  };
}

function pkKey(keys: string[]): string {
  return [...keys].sort().join('+') || '(none)';
}

/** Compare two cube shapes (either may be null = absent on that side). */
export function structuredDiff(dev: CubeShape | null, prod: CubeShape | null): StructuredDiff {
  const changes: FieldChange[] = [];
  if (dev && prod) {
    // primary key set
    const devPk = pkKey(dev.primaryKeys);
    const prodPk = pkKey(prod.primaryKeys);
    if (devPk !== prodPk) {
      changes.push({ field: 'pk', kind: 'changed', before: prodPk, after: devPk });
    }
    // sql_table
    if ((dev.sqlTable ?? '') !== (prod.sqlTable ?? '')) {
      changes.push({
        field: 'sqlTable',
        kind: 'changed',
        before: prod.sqlTable,
        after: dev.sqlTable,
      });
    }
    diffNamedSet('measure', dev.measures.map((m) => m.name), prod.measures.map((m) => m.name), changes);
    // measure type changes (present on both, type differs)
    const prodTypes = new Map(prod.measures.map((m) => [m.name, m.type ?? '']));
    for (const m of dev.measures) {
      if (prodTypes.has(m.name) && prodTypes.get(m.name) !== (m.type ?? '')) {
        changes.push({
          field: 'measure',
          kind: 'changed',
          name: m.name,
          before: prodTypes.get(m.name) ?? null,
          after: m.type ?? null,
        });
      }
    }
    diffNamedSet('join', dev.joins, prod.joins, changes);
    diffNamedSet('rollup', dev.rollups, prod.rollups, changes);
  }
  return { devPresent: dev != null, prodPresent: prod != null, changes };
}

/** Emit added/removed FieldChanges for a named set (dev = "after", prod = "before"). */
function diffNamedSet(field: string, dev: string[], prod: string[], out: FieldChange[]): void {
  const devSet = new Set(dev);
  const prodSet = new Set(prod);
  for (const n of dev) if (!prodSet.has(n)) out.push({ field, kind: 'added', name: n, before: null, after: n });
  for (const n of prod) if (!devSet.has(n)) out.push({ field, kind: 'removed', name: n, before: n, after: null });
}

/**
 * Minimal LCS-based unified line diff. `before` = prod/older, `after` = dev/newer.
 * Emits a flat line list (ctx/add/del) — enough for the UI's diff viewer without
 * pulling in a diff dependency the server doesn't otherwise need.
 */
export function unifiedTextDiff(before: string, after: string): TextDiff {
  const a = before.split('\n');
  const b = after.split('\n');
  const m = a.length;
  const n = b.length;
  // LCS length table.
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const lines: UnifiedDiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'ctx', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push({ kind: 'del', text: a[i] });
      removed++;
      i++;
    } else {
      lines.push({ kind: 'add', text: b[j] });
      added++;
      j++;
    }
  }
  while (i < m) {
    lines.push({ kind: 'del', text: a[i++] });
    removed++;
  }
  while (j < n) {
    lines.push({ kind: 'add', text: b[j++] });
    added++;
  }
  return { lines, added, removed };
}
