/**
 * Segment-side bridge to the shared percentile cutoff engine.
 *
 * A predicate segment with `percentileGte`/`percentileLte` leaves can't be sent
 * to Cube directly (Cube REST can't subquery). Before translation we resolve
 * each percentile leaf to an absolute cutoff over its reference population, then
 * `treeToCubeFilters` compiles a plain `gte`/`lte` scalar. This module collects
 * those leaves and runs the resolution; it is called at create AND every refresh
 * so the cutoff is *rolling* — it re-tracks the live distribution, never frozen.
 *
 * Correctness invariant: the cutoff MUST be computed over the SAME population
 * the membership query selects from, and spend-like distributions MUST be
 * payer-scoped (an unscoped percentile of recharge is 0 — free users dominate —
 * and selects everyone). The population + its scope live on the leaf's
 * `over: PopulationRef`; this module faithfully applies them and rejects a
 * percentile leaf with no population source rather than silently defaulting to
 * the full table.
 */

import type { PredicateNode, LeafNode, PercentileValue, PopulationRef } from '../types/predicate-tree.js';
import type { PercentileQuery } from './percentile-cutoff-resolver.js';
import {
  resolvePercentileCutoff,
  createTrinoPercentileExecutor,
  buildMergedFrom,
} from './percentile-cutoff-resolver.js';
import { predicateToSql, escapeIdent, escapeLiteral } from './predicate-to-sql.js';
import { resolveCsTrinoConnector } from '../lakehouse/cs-trino-connector.js';
import { runQuery } from './trino-rest-client.js';

/** A slow cutoff query must fail fast rather than starve the 60s refresh budget. */
const CUTOFF_TIMEOUT_MS = Number(process.env.SEGMENT_CUTOFF_TIMEOUT_MS ?? 20_000);

/** Thrown when a percentile leaf reaches resolution with no reference population. */
export class PopulationScopeRequiredError extends Error {
  constructor(leafId: string, member: string) {
    super(
      `Percentile leaf ${leafId} (${member}) needs a reference population — supply over.table ` +
        `(and over.filter to scope it, e.g. payers only). An unscoped percentile is not resolvable.`,
    );
    this.name = 'PopulationScopeRequiredError';
  }
}

/** Thrown when no Trino connector is configured to run the cutoff query. */
export class CutoffConnectorUnavailableError extends Error {
  constructor() {
    super('No Trino connector configured to resolve percentile cutoff (profiler or CUBEJS_DB_*).');
    this.name = 'CutoffConnectorUnavailableError';
  }
}

function isPercentileLeaf(node: PredicateNode): node is LeafNode {
  return node.kind === 'leaf' && (node.op === 'percentileGte' || node.op === 'percentileLte');
}

/** Walk the tree, returning every percentile leaf (any depth, AND or OR). */
export function collectPercentileLeaves(tree: PredicateNode): LeafNode[] {
  if (tree.kind === 'leaf') return isPercentileLeaf(tree) ? [tree] : [];
  const out: LeafNode[] = [];
  for (const child of tree.children) out.push(...collectPercentileLeaves(child));
  return out;
}

function percentileValueOf(leaf: LeafNode): PercentileValue {
  const pv = leaf.values[0] as PercentileValue | undefined;
  if (!pv || typeof pv.p !== 'number') {
    throw new PopulationScopeRequiredError(leaf.id, leaf.member);
  }
  return pv;
}

/** Distinct leaf-member columns referenced by a (population filter) predicate. */
function collectLeafColumns(node: PredicateNode | undefined): string[] {
  if (!node) return [];
  if (node.kind === 'leaf') return [node.member];
  return [...new Set(node.children.flatMap(collectLeafColumns))];
}

/**
 * Build the per-user merge spec for a percentile over a multi-row mart, when the
 * population's `identityMerge` is set. `columns` covers the percentile column
 * AND every column the WHERE references, so the merged subquery projects them
 * all. Returns undefined for clean one-row-per-user sources.
 */
function mergeSpecFor(over: PopulationRef, percentileColumn: string): PercentileQuery['merge'] {
  if (!over.identityMerge) return undefined;
  return {
    ...over.identityMerge,
    columns: [percentileColumn, ...collectLeafColumns(over.filter)],
  };
}

/**
 * Resolve every percentile leaf in `tree` to an absolute cutoff. Returns a map
 * keyed by leaf id, ready to thread into `treeToCubeFilters({ resolvedPercentiles })`.
 * Empty (and a no-op) when the tree has no percentile leaves — the common case.
 */
export async function resolveSegmentCutoffs(tree: PredicateNode): Promise<Map<string, number>> {
  const leaves = collectPercentileLeaves(tree);
  const resolved = new Map<string, number>();
  if (leaves.length === 0) return resolved;

  // Validate the request shape (every percentile leaf has a population source)
  // BEFORE reaching for infra, so a malformed tree fails with a typed scope
  // error regardless of whether a Trino connector is configured.
  const specs = leaves.map((leaf) => {
    const pv = percentileValueOf(leaf);
    if (!pv.over?.table) throw new PopulationScopeRequiredError(leaf.id, leaf.member);
    return { leaf, pv, over: pv.over };
  });

  const connector = resolveCsTrinoConnector();
  if (!connector) throw new CutoffConnectorUnavailableError();
  const exec = createTrinoPercentileExecutor(connector, CUTOFF_TIMEOUT_MS);

  for (const { leaf, pv, over } of specs) {
    // Compile the structured population scope into a WHERE clause (trusted —
    // predicateToSql validates idents + escapes literals). The percentile column
    // is over.column (physical), defaulting to the leaf member.
    const column = over.column ?? leaf.member;
    const where = over.filter ? predicateToSql(over.filter) : undefined;
    const merge = mergeSpecFor(over, column);
    const cutoff = await resolvePercentileCutoff(column, pv, exec, { where, merge });
    resolved.set(leaf.id, cutoff);
  }
  return resolved;
}

/** One-shot resolved-cutoff preview for the propose card (no segment written). */
export interface CutoffPreview {
  cutoff: number;
  /** Rows in the (scoped) reference population. */
  populationCount: number;
  /** Rows at/over (gte) or at/under (lte) the cutoff — the est. cohort size. */
  estCount: number;
}

/**
 * Resolve a cutoff AND estimate the cohort it selects, for the chat propose
 * card. Runs the percentile over the scoped population, then a matched count.
 * `gte` true ⇒ "top" (>= cutoff); false ⇒ "bottom" (<= cutoff).
 */
export async function resolveCutoffPreview(args: {
  table: string;
  column: string;
  p: number;
  gte: boolean;
  filter?: PredicateNode;
  identityMerge?: PopulationRef['identityMerge'];
}): Promise<CutoffPreview> {
  const connector = resolveCsTrinoConnector();
  if (!connector) throw new CutoffConnectorUnavailableError();

  const table = escapeIdent(args.table);
  const column = escapeIdent(args.column);
  const where = args.filter ? predicateToSql(args.filter) : undefined;
  const whereClause = where ? ` WHERE ${where}` : '';
  const schema = connector.catalog ?? '';
  // Same per-user collapse as the cutoff resolution, so the population size and
  // matched count are over the merged grain (one row per user), not raw rows.
  const merge = args.identityMerge
    ? { ...args.identityMerge, columns: [args.column, ...collectLeafColumns(args.filter)] }
    : undefined;
  const from = buildMergedFrom(table, merge);

  // Cutoff + scoped population size in a single scan.
  const head = await runQuery(
    connector,
    schema,
    `SELECT approx_percentile(${column}, ${args.p / 100}) AS cutoff, count(*) AS pop FROM ${from}${whereClause}`,
    CUTOFF_TIMEOUT_MS,
  );
  const row = head.rows?.[0] ?? [];
  const cutoff = Number(row[0]);
  const populationCount = Number(row[1]);
  if (!Number.isFinite(cutoff)) {
    throw new Error(`resolveCutoffPreview: non-finite cutoff for P${args.p} of ${args.column}`);
  }

  // Matched count at the resolved cutoff, within the same scoped population.
  const cmp = args.gte ? '>=' : '<=';
  const matchWhere = where ? `${where} AND ` : '';
  const matched = await runQuery(
    connector,
    schema,
    `SELECT count(*) AS n FROM ${from} WHERE ${matchWhere}${column} ${cmp} ${escapeLiteral(cutoff)}`,
    CUTOFF_TIMEOUT_MS,
  );
  const estCount = Number(matched.rows?.[0]?.[0] ?? 0);

  return { cutoff, populationCount, estCount };
}
