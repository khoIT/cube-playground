import yaml from 'js-yaml';
import type { NewMetricDraftV3, DimBuilder, BandingRow } from '../types';
import type { FilterLeaf } from '../filter-tree';

export type DimensionContext = {
  sourceCube: string;
  createdAt?: string;
  author?: string;
};

export type DimensionEmit = {
  yaml: string;
  fragment: string;
  sectionKey: 'dimensions';
};

const CONTROL_BYTES_RE = /[\x00-\x1f]/;

function assertSafePredicateValue(raw: string): void {
  if (CONTROL_BYTES_RE.test(raw)) {
    throw new Error('generate-dimension: control bytes rejected in predicate value');
  }
  // No unescaped semicolons — defends against trailing-statement injection if
  // the value somehow makes it into a raw SQL slot (it shouldn't — we always
  // quote string values, but enforce defence-in-depth).
  if (raw.includes(';')) {
    throw new Error('generate-dimension: semicolons rejected in predicate value');
  }
}

function quoteValue(value: string, columnType: FilterLeaf['columnType']): string {
  assertSafePredicateValue(value);
  switch (columnType) {
    case 'number':
    case 'integer':
      if (!/^-?\d+(\.\d+)?$/.test(value)) {
        throw new Error(
          `generate-dimension: non-numeric value "${value}" for numeric column — reject`
        );
      }
      return value;
    case 'boolean': {
      const v = value.toLowerCase();
      if (v !== 'true' && v !== 'false') {
        throw new Error(`generate-dimension: non-boolean value "${value}" — reject`);
      }
      return v;
    }
    case 'string':
    case 'time':
    case 'date': {
      const escaped = value.replace(/'/g, "''");
      return `'${escaped}'`;
    }
    default:
      throw new Error(`generate-dimension: unknown column type "${columnType}"`);
  }
}

function leafToPredicateSql(leaf: FilterLeaf): string {
  // Boolean dim predicates run on the underlying SQL columns of the cube being
  // authored — that cube may not yet have a Cube member for this column, so we
  // emit `{CUBE}.<col>` (raw-column form) per F-2.
  const ref = `{CUBE}.${leaf.column}`;
  const first = leaf.values[0] ?? '';
  switch (leaf.op) {
    case 'set':
      return `${ref} IS NOT NULL`;
    case 'notSet':
      return `${ref} IS NULL`;
    case 'IN': {
      if (leaf.values.length === 0) {
        throw new Error('generate-dimension: IN requires at least one value');
      }
      const list = leaf.values.map((v) => quoteValue(v, leaf.columnType)).join(', ');
      return `${ref} IN (${list})`;
    }
    case 'NOT IN': {
      if (leaf.values.length === 0) {
        throw new Error('generate-dimension: NOT IN requires at least one value');
      }
      const list = leaf.values.map((v) => quoteValue(v, leaf.columnType)).join(', ');
      return `${ref} NOT IN (${list})`;
    }
    case 'contains': {
      assertSafePredicateValue(first);
      const escaped = first.replace(/'/g, "''").replace(/%/g, '%%');
      return `${ref} LIKE '%${escaped}%'`;
    }
    case 'startsWith': {
      assertSafePredicateValue(first);
      const escaped = first.replace(/'/g, "''").replace(/%/g, '%%');
      return `${ref} LIKE '${escaped}%'`;
    }
    case '=':
      return `${ref} = ${quoteValue(first, leaf.columnType)}`;
    case '!=':
      return `${ref} != ${quoteValue(first, leaf.columnType)}`;
    case '>':
      return `${ref} > ${quoteValue(first, leaf.columnType)}`;
    case '<':
      return `${ref} < ${quoteValue(first, leaf.columnType)}`;
    case '>=':
      return `${ref} >= ${quoteValue(first, leaf.columnType)}`;
    case '<=':
      return `${ref} <= ${quoteValue(first, leaf.columnType)}`;
    default:
      throw new Error(`generate-dimension: unknown operator "${String(leaf.op)}"`);
  }
}

function buildMetaBlock(
  draft: NewMetricDraftV3,
  createdAt: string,
  author: string
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    source: 'wizard',
    author,
    created_at: createdAt,
    grain: draft.grain,
    visibility: draft.visibility,
  };
  if (draft.tags.length > 0) meta.tags = draft.tags;
  return meta;
}

function buildBandingMapping(
  draft: NewMetricDraftV3,
  builder: Extract<DimBuilder, { kind: 'banding' }>,
  meta: Record<string, unknown>
): Record<string, unknown> {
  const when = builder.bands.map((b: BandingRow) => ({ sql: b.sql, label: b.label }));
  const caseBlock = {
    when,
    else: { label: builder.elseLabel },
  };
  const entries: Array<[string, unknown]> = [
    ['name', draft.name],
    ['type', 'string'],
    ['case', caseBlock],
  ];
  if (draft.title) entries.push(['title', draft.title]);
  if (draft.description) entries.push(['description', draft.description]);
  entries.push(['meta', meta]);
  return Object.fromEntries(entries);
}

function buildTimeSinceMapping(
  draft: NewMetricDraftV3,
  builder: Extract<DimBuilder, { kind: 'time-since' }>,
  meta: Record<string, unknown>
): Record<string, unknown> {
  if (!builder.timeColumn) {
    throw new Error('generate-dimension: time-since requires a timeColumn');
  }
  const sqlExpr = `DATE_DIFF('${builder.unit}', {CUBE}.${builder.timeColumn}, CURRENT_DATE)`;
  const entries: Array<[string, unknown]> = [
    ['name', draft.name],
    ['type', 'number'],
    ['sql', sqlExpr],
  ];
  if (draft.title) entries.push(['title', draft.title]);
  if (draft.description) entries.push(['description', draft.description]);
  entries.push(['meta', meta]);
  return Object.fromEntries(entries);
}

function buildPassthroughMapping(
  draft: NewMetricDraftV3,
  builder: Extract<DimBuilder, { kind: 'passthrough' }>,
  meta: Record<string, unknown>
): Record<string, unknown> {
  if (!builder.column) {
    throw new Error('generate-dimension: passthrough requires a column');
  }
  const entries: Array<[string, unknown]> = [
    ['name', draft.name],
    ['type', builder.outputType],
    ['sql', builder.column],
  ];
  if (draft.title) entries.push(['title', draft.title]);
  if (draft.description) entries.push(['description', draft.description]);
  entries.push(['meta', meta]);
  return Object.fromEntries(entries);
}

function buildBooleanMapping(
  draft: NewMetricDraftV3,
  builder: Extract<DimBuilder, { kind: 'boolean' }>,
  meta: Record<string, unknown>
): Record<string, unknown> {
  if (!builder.predicate) {
    throw new Error('generate-dimension: boolean requires a predicate');
  }
  const inner = leafToPredicateSql(builder.predicate);
  const sqlExpr = `CASE WHEN ${inner} THEN TRUE ELSE FALSE END`;
  const entries: Array<[string, unknown]> = [
    ['name', draft.name],
    ['type', 'boolean'],
    ['sql', sqlExpr],
  ];
  if (draft.title) entries.push(['title', draft.title]);
  if (draft.description) entries.push(['description', draft.description]);
  entries.push(['meta', meta]);
  return Object.fromEntries(entries);
}

/**
 * Emit YAML for a dimension entry. Returns the inner mapping (fragment), a full
 * `dimensions:` block (yaml), and the sectionKey the splicer / preview rail use
 * to route the patch and label the section header.
 *
 * SQL template form per F-2:
 *   - banding `case.when[].sql`        → `{CUBE}.<raw_column>` (raw column ref)
 *   - time-since `sql:`                → `{CUBE}.<raw_column>`
 *   - passthrough `sql:`               → bare `<column>` (no template)
 *   - boolean `sql:` predicate inside  → `{CUBE}.<raw_column>`
 *
 * Boolean predicate is `FilterLeaf`-shaped — raw SQL is never accepted here.
 * Sanitization (`;`, control bytes, type-mismatch values) is enforced before
 * the YAML mapping is built.
 */
export function generateDimension(
  draft: NewMetricDraftV3,
  ctx: DimensionContext
): DimensionEmit {
  const builder = draft.dimBuilder;
  if (!builder) {
    throw new Error('generate-dimension: draft.dimBuilder is required');
  }
  const createdAt = ctx.createdAt ?? new Date().toISOString();
  const author = ctx.author ?? 'khoitn';
  const meta = buildMetaBlock(draft, createdAt, author);

  let mapping: Record<string, unknown>;
  switch (builder.kind) {
    case 'banding':
      mapping = buildBandingMapping(draft, builder, meta);
      break;
    case 'time-since':
      mapping = buildTimeSinceMapping(draft, builder, meta);
      break;
    case 'passthrough':
      mapping = buildPassthroughMapping(draft, builder, meta);
      break;
    case 'boolean':
      mapping = buildBooleanMapping(draft, builder, meta);
      break;
    default:
      throw new Error(
        `generate-dimension: unknown / unsupported dimBuilder kind "${(builder as DimBuilder).kind}"`
      );
  }

  const dumpOpts: yaml.DumpOptions = { indent: 2, lineWidth: -1, noRefs: true };
  const fragment = yaml.dump(mapping, dumpOpts).trimEnd();
  const fragmentLines = fragment.split('\n');
  const indented = fragmentLines
    .map((line, i) => (i === 0 ? `  - ${line}` : `    ${line}`))
    .join('\n');
  const fullYaml = `dimensions:\n${indented}`;
  return { yaml: fullYaml, fragment, sectionKey: 'dimensions' };
}
