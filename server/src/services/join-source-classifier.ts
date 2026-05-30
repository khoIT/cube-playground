/**
 * Join-source classifier — decides whether a proposed join between two cubes is
 * SAME-source (executes as a real SQL `joins:` entry) or CROSS-source (Cube
 * cannot SQL-join across dataSources; it needs a rollupJoin over pre-aggregations).
 *
 * v2 is honest about the engine limit: cross-source links are DECLARED + FLAGGED
 * as an advisory, never emitted as an executing join. This module is the single
 * place that decision + the advisory text live, so the scaffolder, builder, and
 * entity-graph all classify consistently.
 *
 * Pure + dependency-free → unit-tested without a DB.
 */

export type JoinSourceClass = 'same' | 'cross';

export interface JoinClassification {
  class: JoinSourceClass;
  /** dataSource of each side (the connector / registry id; '' = default). */
  fromDataSource: string;
  toDataSource: string;
  /** Human advisory shown in UI + emitted as a YAML comment for cross-source. */
  advisory?: string;
}

function norm(ds: string | null | undefined): string {
  // Treat empty / 'default' / 'trino' bootstrap as the same canonical source so
  // legacy cubes (no data_source) don't look cross-source against the Trino one.
  const v = (ds ?? '').trim().toLowerCase();
  return v === 'default' || v === 'trino' ? '' : v;
}

/**
 * Classify a join from one cube's dataSource to another's. Same canonical source
 * → 'same'; otherwise 'cross' with a rollupJoin advisory.
 */
export function classifyJoin(fromDataSource: string | null | undefined, toDataSource: string | null | undefined): JoinClassification {
  const from = norm(fromDataSource);
  const to = norm(toDataSource);
  if (from === to) {
    return { class: 'same', fromDataSource: from, toDataSource: to };
  }
  return {
    class: 'cross',
    fromDataSource: from,
    toDataSource: to,
    advisory:
      `cross-source join (${from || 'default'} → ${to || 'default'}) — Cube cannot SQL-join across ` +
      `dataSources; requires a rollupJoin over pre-aggregations. Declared here, not executed.`,
  };
}

/** YAML comment line for a cross-source advisory (scaffolder emit). */
export function crossSourceComment(c: JoinClassification): string {
  return `# ${c.advisory ?? 'cross-source join — requires rollupJoin/pre-agg; not executed'}`;
}
