import yaml from 'js-yaml';
import { BinaryFilter, UnaryFilter } from '@cubejs-client/core';
import { NewMetricDraft, Operation } from '../types';
import { ReachableMember } from '../hooks/use-reachable-members';
import { inferConvention, adaptName } from './infer-naming-convention';

// Context required to resolve cross-cube references and peer naming
export type GenerateContext = {
  sourceCube: string;
  reachableMembers: ReachableMember[];
  peerMeasureNames: string[];
};

// Cube YAML type string for each operation
const OPERATION_TYPE: Record<Operation, string> = {
  sum: 'sum',
  count: 'count',
  countDistinct: 'count_distinct',
  avg: 'avg',
  min: 'min',
  max: 'max',
  ratio: 'number',
};

/**
 * Convert a filter (BinaryFilter | UnaryFilter) to a Cube sql string.
 * Returns null if the filter shape is unrecognised (caller omits filters key).
 */
function filterToSql(filter: BinaryFilter | UnaryFilter): string | null {
  const member = filter.member ?? (filter as any).dimension ?? '';
  // Convert "cube.col" → "{cube}.col" Cube reference syntax by splitting on first dot.
  const dotIdx = member.indexOf('.');
  const cubeRef = dotIdx >= 0
    ? `{${member.slice(0, dotIdx)}}.${member.slice(dotIdx + 1)}`
    : member;

  const op = filter.operator;

  if (op === 'set') return `${cubeRef} IS NOT NULL`;
  if (op === 'notSet') return `${cubeRef} IS NULL`;

  const bf = filter as BinaryFilter;
  const vals = bf.values ?? [];
  const first = vals[0] ?? '';
  const quoted = `'${first}'`;

  switch (op) {
    case 'equals': return `${cubeRef} = ${quoted}`;
    case 'notEquals': return `${cubeRef} != ${quoted}`;
    case 'contains': return `${cubeRef} LIKE '%${first}%'`;
    case 'notContains': return `${cubeRef} NOT LIKE '%${first}%'`;
    case 'gt': return `${cubeRef} > ${quoted}`;
    case 'lt': return `${cubeRef} < ${quoted}`;
    case 'gte': return `${cubeRef} >= ${quoted}`;
    case 'lte': return `${cubeRef} <= ${quoted}`;
    default:
      // Unknown operator — omit filters rather than crash
      return null;
  }
}

/**
 * Find a ReachableMember by qualified name (e.g. "orders.amount").
 */
function findMember(members: ReachableMember[], qualifiedName: string): ReachableMember | undefined {
  return members.find((m) => m.memberName === qualifiedName);
}

/**
 * Build the sql expression for a non-ratio measure.
 * Cross-cube: "{remoteCube}.shortName", Same-cube: "{sourceCube}.shortName"
 */
function buildSqlRef(member: ReachableMember | undefined, sourceCube: string, qualifiedName: string): string {
  if (!member) {
    // Fallback: derive from qualifiedName directly
    const dot = qualifiedName.indexOf('.');
    if (dot >= 0) {
      const cube = qualifiedName.slice(0, dot);
      const col = qualifiedName.slice(dot + 1);
      return `{${cube}}.${col}`;
    }
    return `{${sourceCube}}.${qualifiedName}`;
  }
  const cube = member.cubeName;
  return `{${cube}}.${member.shortName}`;
}

/**
 * Generate YAML for a new measure from the wizard draft.
 *
 * Returns:
 *   - `yaml`: full preview string with `measures:` prefix (for display)
 *   - `fragment`: just the measure mapping as a YAML string (for backend splice)
 */
export function generate(
  draft: NewMetricDraft,
  ctx: GenerateContext
): { yaml: string; fragment: string } {
  const { sourceCube, reachableMembers, peerMeasureNames } = ctx;

  // Determine name casing
  const convention = inferConvention(peerMeasureNames);
  const measureName = adaptName(draft.name, convention);

  // Build type
  const type = OPERATION_TYPE[draft.operation] ?? draft.operation;

  // Build sql expression
  let sqlExpr: string;

  if (draft.operation === 'ratio') {
    const memberA = findMember(reachableMembers, draft.ofMember ?? '');
    const memberB = findMember(reachableMembers, draft.ofMemberB ?? '');
    // Both operands treated as same-cube (Phase 1 validation enforces this)
    const refA = memberA ? `{${sourceCube}}.${memberA.shortName}` : `{${sourceCube}}.${draft.ofMember ?? ''}`;
    const refB = memberB ? `{${sourceCube}}.${memberB.shortName}` : `{${sourceCube}}.${draft.ofMemberB ?? ''}`;
    sqlExpr = `${refA} / NULLIF(${refB}, 0)`;
  } else {
    const member = findMember(reachableMembers, draft.ofMember ?? '');
    sqlExpr = buildSqlRef(member, sourceCube, draft.ofMember ?? '');
  }

  // Build filters array (optional)
  let filtersValue: Array<{ sql: string }> | undefined;
  if (draft.filter) {
    const filterSql = filterToSql(draft.filter);
    if (filterSql) {
      filtersValue = [{ sql: filterSql }];
    }
    // If filterSql is null (unknown operator), omit filters silently
  }

  // Build the measure mapping with STABLE key order
  // Use array of [key, value] tuples so insertion order is preserved through js-yaml
  const entries: Array<[string, unknown]> = [
    ['name', measureName],
    ['type', type],
    ['sql', sqlExpr],
  ];

  if (draft.title) entries.push(['title', draft.title]);
  if (draft.description) entries.push(['description', draft.description]);
  if (draft.format && draft.format !== 'number') entries.push(['format', draft.format]);
  if (filtersValue) entries.push(['filters', filtersValue]);

  const mapping = Object.fromEntries(entries);

  // Serialize with stable settings
  const dumpOpts: yaml.DumpOptions = { indent: 2, lineWidth: -1, noRefs: true };

  // fragment = the mapping YAML string (no leading "- " or "measures:" prefix)
  const fragment = yaml.dump(mapping, dumpOpts).trimEnd();

  // Full preview: indent the fragment under "measures:" with "  - " on first line
  // and "    " on subsequent lines
  const fragmentLines = fragment.split('\n');
  const indented = fragmentLines
    .map((line, i) => (i === 0 ? `  - ${line}` : `    ${line}`))
    .join('\n');

  const fullYaml = `measures:\n${indented}`;

  return { yaml: fullYaml, fragment };
}
