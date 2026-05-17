import yaml from 'js-yaml';
import type { NewMetricDraftV3 } from '../types';
import type { FilterLeaf, FilterNode } from '../filter-tree';
import { flattenToSql, isEmpty as filterTreeIsEmpty } from '../filter-tree';

export type SegmentContext = {
  sourceCube: string;
  createdAt?: string;
  author?: string;
};

export type SegmentEmit = {
  yaml: string;
  fragment: string;
  sectionKey: 'segments';
};

function collectLeaves(node: FilterNode, acc: FilterLeaf[]): void {
  if (node.kind === 'leaf') {
    acc.push(node);
    return;
  }
  for (const c of node.children) collectLeaves(c, acc);
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

/**
 * Emit YAML for a segment entry. Segments are named filter trees — the inner
 * `sql:` is produced by `flattenToSql` which already uses Cube member-reference
 * form (`{member}` same-cube, `{cube.member}` cross-cube) per F-2.
 *
 * v1 scope is single-cube — leaves referencing a non-source cube throw.
 */
export function generateSegment(
  draft: NewMetricDraftV3,
  ctx: SegmentContext
): SegmentEmit {
  if (filterTreeIsEmpty(draft.filterTree)) {
    throw new Error('generate-segment: filter tree is empty — segment SQL cannot be empty');
  }

  // Defensive cross-cube check (F-9). Leaves use qualified `cube.column` form;
  // a bare column name is same-cube. Anything else must match sourceCube.
  const leaves: FilterLeaf[] = [];
  collectLeaves(draft.filterTree, leaves);
  for (const leaf of leaves) {
    const dot = leaf.column.indexOf('.');
    if (dot >= 0) {
      const cube = leaf.column.slice(0, dot);
      if (cube !== ctx.sourceCube) {
        throw new Error(
          `generate-segment: segment v1 is single-cube — leaf "${leaf.column}" references cube "${cube}"`
        );
      }
    }
  }

  const sql = flattenToSql(draft.filterTree, ctx.sourceCube);
  if (!sql) {
    throw new Error('generate-segment: filter tree flattened to empty SQL');
  }

  const createdAt = ctx.createdAt ?? new Date().toISOString();
  const author = ctx.author ?? 'khoitn';
  const meta = buildMetaBlock(draft, createdAt, author);

  const entries: Array<[string, unknown]> = [
    ['name', draft.name],
    ['sql', sql],
  ];
  if (draft.description) entries.push(['description', draft.description]);
  entries.push(['meta', meta]);
  const mapping = Object.fromEntries(entries);

  const dumpOpts: yaml.DumpOptions = { indent: 2, lineWidth: -1, noRefs: true };
  const fragment = yaml.dump(mapping, dumpOpts).trimEnd();
  const fragmentLines = fragment.split('\n');
  const indented = fragmentLines
    .map((line, i) => (i === 0 ? `  - ${line}` : `    ${line}`))
    .join('\n');
  const fullYaml = `segments:\n${indented}`;
  return { yaml: fullYaml, fragment, sectionKey: 'segments' };
}
