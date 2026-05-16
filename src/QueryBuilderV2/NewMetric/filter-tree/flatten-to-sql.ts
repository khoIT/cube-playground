import { ColumnType, ColumnTypeMap, FilterLeaf, FilterNode } from './types';

const CONTROL_BYTES_RE = /[\x00-\x1f]/; // includes \r \n \t
const KNOWN_TYPES: ReadonlyArray<ColumnType> = [
  'string',
  'number',
  'integer',
  'boolean',
  'time',
  'date',
];

function assertSafe(raw: string): void {
  if (CONTROL_BYTES_RE.test(raw)) {
    throw new Error('flatten-to-sql: control bytes / CR / LF in value rejected');
  }
}

function quote(value: string, type: ColumnType): string {
  assertSafe(value);
  switch (type) {
    case 'number':
    case 'integer': {
      // Numeric — emit raw if parseable, else throw
      if (!/^-?\d+(\.\d+)?$/.test(value)) {
        throw new Error(`flatten-to-sql: non-numeric value "${value}" for numeric column`);
      }
      return value;
    }
    case 'boolean': {
      const v = value.toLowerCase();
      if (v !== 'true' && v !== 'false') {
        throw new Error(`flatten-to-sql: non-boolean value "${value}"`);
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
      throw new Error(`flatten-to-sql: unknown column type "${type}"`);
  }
}

function cubeRef(qualifiedColumn: string): string {
  const dot = qualifiedColumn.indexOf('.');
  if (dot < 0) return qualifiedColumn;
  return `{${qualifiedColumn.slice(0, dot)}}.${qualifiedColumn.slice(dot + 1)}`;
}

function leafToSql(leaf: FilterLeaf): string {
  if (!KNOWN_TYPES.includes(leaf.columnType)) {
    throw new Error(`flatten-to-sql: unknown column type "${leaf.columnType}"`);
  }
  const ref = cubeRef(leaf.column);
  const first = leaf.values[0] ?? '';
  switch (leaf.op) {
    case 'set':
      return `${ref} IS NOT NULL`;
    case 'notSet':
      return `${ref} IS NULL`;
    case 'IN': {
      if (leaf.values.length === 0) {
        throw new Error('flatten-to-sql: IN requires at least one value');
      }
      const list = leaf.values.map((v) => quote(v, leaf.columnType)).join(', ');
      return `${ref} IN (${list})`;
    }
    case 'NOT IN': {
      if (leaf.values.length === 0) {
        throw new Error('flatten-to-sql: NOT IN requires at least one value');
      }
      const list = leaf.values.map((v) => quote(v, leaf.columnType)).join(', ');
      return `${ref} NOT IN (${list})`;
    }
    case 'contains': {
      assertSafe(first);
      const escaped = first.replace(/'/g, "''").replace(/%/g, '%%');
      return `${ref} LIKE '%${escaped}%'`;
    }
    case 'startsWith': {
      assertSafe(first);
      const escaped = first.replace(/'/g, "''").replace(/%/g, '%%');
      return `${ref} LIKE '${escaped}%'`;
    }
    case '=':
      return `${ref} = ${quote(first, leaf.columnType)}`;
    case '!=':
      return `${ref} != ${quote(first, leaf.columnType)}`;
    case '>':
      return `${ref} > ${quote(first, leaf.columnType)}`;
    case '<':
      return `${ref} < ${quote(first, leaf.columnType)}`;
    case '>=':
      return `${ref} >= ${quote(first, leaf.columnType)}`;
    case '<=':
      return `${ref} <= ${quote(first, leaf.columnType)}`;
    default:
      throw new Error(`flatten-to-sql: unknown operator "${String(leaf.op)}"`);
  }
}

export function flattenToSql(node: FilterNode, _columnTypes?: ColumnTypeMap): string {
  if (node.kind === 'leaf') return leafToSql(node);

  // Group — drop empty groups, recurse non-empty children
  const parts: string[] = [];
  for (const c of node.children) {
    if (c.kind === 'group' && c.children.length === 0) continue;
    parts.push(flattenToSql(c));
  }
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  const joined = parts.map((p) => `(${p})`).join(` ${node.op} `);
  return joined;
}
