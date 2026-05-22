/**
 * Read-only viewer for a segment's predicate tree.
 * Renders the AND/OR group structure as a nested indent list with
 * member · operator · values per leaf. Group nodes are collapsible.
 * Manual segments show an info note.
 */

import { ReactElement, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  Segment,
  PredicateNode,
  GroupNode,
  LeafNode,
} from '../../../../types/segment-api';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
}

function isGroup(n: PredicateNode): n is GroupNode {
  return n.kind === 'group';
}

function LeafRow({ leaf }: { leaf: LeafNode }): ReactElement {
  const values = leaf.values.length
    ? leaf.values.map((v) => JSON.stringify(v)).join(', ')
    : '—';
  return (
    <div className={styles.predicateLeaf}>
      <code>{leaf.member}</code>
      <span className={styles.predicateOp}>{leaf.op}</span>
      <span>{values}</span>
    </div>
  );
}

function NodeTree({
  node,
  depth = 0,
}: {
  node: PredicateNode;
  depth?: number;
}): ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  if (!isGroup(node)) return <LeafRow leaf={node} />;
  const childCount = node.children.length;

  if (childCount === 0) {
    return (
      <div
        className={styles.predicateGroup}
        style={{ marginLeft: depth * 16 }}
      >
        <span className={styles.predicateGroupHeader}>{node.op}</span>
        <span className={styles.predicateEmpty}>(no filters — matches all)</span>
      </div>
    );
  }
  return (
    <div
      className={styles.predicateGroup}
      style={{ marginLeft: depth * 16 }}
    >
      <button
        type="button"
        className={styles.predicateGroupToggle}
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronRight size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
        <span className={styles.predicateGroupHeader}>{node.op}</span>
        {collapsed && (
          <span className={styles.predicateGroupCount}>· {childCount}</span>
        )}
      </button>
      {!collapsed && node.children.map((c, i) => (
        <NodeTree key={isGroup(c) ? `g${i}` : c.id} node={c} depth={depth + 1} />
      ))}
    </div>
  );
}

export function PredicateTab({ segment }: Props): ReactElement {
  const { t } = useTranslation();

  if (segment.type === 'manual') {
    return (
      <div className={styles.tabBody}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {t('segments.detail.predicate.manual')}
        </p>
      </div>
    );
  }

  const tree = segment.predicate_tree;
  if (!tree) {
    return (
      <div className={styles.tabBody}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {t('segments.detail.predicate.empty')}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.tabBody}>
      <div className={styles.predicateToolbar}>
        <Link to={`/segments/${segment.id}/edit`}>
          {t('segments.detail.predicate.editLink')}
        </Link>
      </div>
      <NodeTree node={tree} />
    </div>
  );
}
