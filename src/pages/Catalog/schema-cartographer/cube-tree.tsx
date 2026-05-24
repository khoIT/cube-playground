/**
 * CubeTree — collapsible per-cube list of members (measures + dimensions
 * + segments). Clicking a leaf selects it for the detail panel.
 */
import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import styled from 'styled-components';
import type { CartographerIndex, CartographerMember } from './use-cartographer-index';

interface Props {
  index: CartographerIndex;
  /** When non-empty, only these members render (search result narrowing). */
  visibleFqns?: ReadonlySet<string>;
  selectedFqn?: string;
  onSelect: (fqn: string) => void;
}

const Tree = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: var(--font-sans);
  font-size: 13px;
`;

const CubeRow = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  font-weight: 600;

  &:hover {
    background: var(--bg-muted);
  }
`;

const MemberRow = styled.button<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 8px 4px 28px;
  border: none;
  background: ${(p) => (p.$selected ? 'var(--bg-muted)' : 'transparent')};
  border-radius: 6px;
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
  font-size: 12.5px;

  &:hover {
    background: var(--bg-muted);
    color: var(--text-primary);
  }
`;

const KindTag = styled.span<{ $kind: CartographerMember['kind'] }>`
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1px 6px;
  border-radius: 3px;
  background: ${(p) =>
    p.$kind === 'measure'
      ? 'rgba(240,90,34,0.15)'
      : p.$kind === 'dimension'
      ? 'rgba(0,120,200,0.15)'
      : 'rgba(120,120,120,0.15)'};
  color: ${(p) =>
    p.$kind === 'measure'
      ? '#c44a1d'
      : p.$kind === 'dimension'
      ? '#0a6cb0'
      : '#555'};
`;

export function CubeTree({ index, visibleFqns, selectedFqn, onSelect }: Props) {
  const grouped = useMemo(() => {
    const byCube = new Map<string, CartographerMember[]>();
    for (const m of index.members) {
      if (visibleFqns && !visibleFqns.has(m.fqn)) continue;
      const arr = byCube.get(m.cubeName) ?? [];
      arr.push(m);
      byCube.set(m.cubeName, arr);
    }
    return Array.from(byCube.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [index, visibleFqns]);

  // Default: all cubes expanded when a filter is active OR there's a selection.
  // Collapsed otherwise to keep the page tidy on large catalogs.
  const filtering = !!visibleFqns;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <Tree>
      {grouped.map(([cubeName, members]) => {
        const expanded = filtering || !collapsed[cubeName];
        return (
          <div key={cubeName}>
            <CubeRow
              type="button"
              onClick={() => setCollapsed((m) => ({ ...m, [cubeName]: !m[cubeName] && !filtering }))}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span style={{ flex: 1 }}>{cubeName}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{members.length}</span>
            </CubeRow>
            {expanded
              ? members.map((m) => (
                  <MemberRow
                    key={m.fqn}
                    type="button"
                    $selected={m.fqn === selectedFqn}
                    onClick={() => onSelect(m.fqn)}
                  >
                    <KindTag $kind={m.kind}>{m.kind[0]}</KindTag>
                    <span>{m.memberName}</span>
                    {m.title ? (
                      <span style={{ marginLeft: 4, color: 'var(--text-muted)' }}>· {m.title}</span>
                    ) : null}
                  </MemberRow>
                ))
              : null}
          </div>
        );
      })}
      {grouped.length === 0 ? (
        <div style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
          No members match.
        </div>
      ) : null}
    </Tree>
  );
}
