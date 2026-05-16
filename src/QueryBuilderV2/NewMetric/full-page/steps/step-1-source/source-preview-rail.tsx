import { useState } from 'react';
import styled from 'styled-components';
import { Database, Layers, Hash, Type, Clock, ToggleRight, ChevronDown } from 'lucide-react';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';

const Card = styled.div`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 12px;
  margin-bottom: 12px;
  overflow: hidden;
`;

const SourceHead = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px 0;
`;

const SourceName = styled.div`
  flex: 1;
  font-family: var(--font-mono);
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TypePill = styled.span`
  flex: none;
  padding: 2px 8px;
  background: var(--brand-soft);
  color: var(--brand);
  border: 1px solid var(--orange-200);
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
`;

const SourceDesc = styled.div`
  padding: 6px 14px 0;
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.45;
`;

const StatsRow = styled.div`
  display: flex;
  gap: 18px;
  margin-top: 10px;
  padding: 10px 14px 12px;
  border-top: 1px solid var(--border-card);
`;

const StatLabel = styled.div`
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
`;

const StatValue = styled.div`
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 1px;
`;

const SectionHead = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-card);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
`;

const ColumnRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-top: 1px solid var(--border-card);
  &:first-of-type { border-top: none; }
`;

const ColumnName = styled.span`
  flex: 1;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ColumnType = styled.span`
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-muted);
`;

const MoreBtn = styled.button`
  appearance: none;
  background: transparent;
  border: none;
  border-top: 1px solid var(--border-card);
  padding: 9px 14px;
  width: 100%;
  font-size: 11.5px;
  color: var(--text-muted);
  cursor: pointer;
  text-align: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  &:hover { background: var(--bg-muted); color: var(--text-primary); }
`;

const TypeCardBody = styled.div`
  padding: 12px 14px;
`;

const TypeCardLabel = styled.div`
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 8px;
`;

const Bar = styled.div`
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--bg-muted);
`;
const Seg = styled.div<{ $color: string }>`
  background: ${(p) => p.$color};
`;

const Legend = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 8px;
`;

const TYPE_COLORS: Record<string, string> = {
  numeric: '#3f8dff',
  integer: '#3f8dff',
  string: '#737373',
  date: '#a855f7',
  time: '#a855f7',
  boolean: '#10b981',
  other: '#f59e0b',
};

function classify(t: string | undefined): keyof typeof TYPE_COLORS {
  if (!t) return 'other';
  const lo = t.toLowerCase();
  if (lo === 'number' || lo === 'integer') return lo === 'integer' ? 'integer' : 'numeric';
  if (lo === 'string') return 'string';
  if (lo === 'time' || lo === 'date') return lo === 'date' ? 'date' : 'time';
  if (lo === 'boolean') return 'boolean';
  return 'other';
}

function typeIcon(t: string | undefined) {
  const kind = classify(t);
  const color = TYPE_COLORS[kind];
  if (kind === 'string') return <Type size={11} color={color} />;
  if (kind === 'time' || kind === 'date') return <Clock size={11} color={color} />;
  if (kind === 'boolean') return <ToggleRight size={11} color={color} />;
  return <Hash size={11} color={color} />;
}

const TOP_N = 6;

export function SourcePreviewRail({ cube }: { cube: WizardCube | null }) {
  const [expanded, setExpanded] = useState(false);

  if (!cube) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        Pick a source to see its columns and type distribution.
      </div>
    );
  }

  const allCols = [
    ...(cube.dimensions ?? []),
    ...(cube.measures ?? []).map((m) => ({ name: m.name, title: m.title, type: m.aggType })),
  ];
  const visibleCols = expanded ? allCols : allCols.slice(0, TOP_N);
  const remaining = allCols.length - visibleCols.length;

  const counts: Record<string, number> = {};
  for (const col of allCols) {
    const k = classify(col.type);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const types = Object.entries(counts);

  const isView = cube.type === 'view';
  const SourceIcon = isView ? Layers : Database;

  return (
    <>
      <Card>
        <SourceHead>
          <SourceIcon size={14} color="var(--brand)" />
          <SourceName>{cube.name}</SourceName>
          <TypePill>{isView ? 'View' : 'Cube'}</TypePill>
        </SourceHead>
        {cube.description && <SourceDesc>{cube.description}</SourceDesc>}
        <StatsRow>
          <div>
            <StatLabel>Cols</StatLabel>
            <StatValue>{allCols.length}</StatValue>
          </div>
          <div>
            <StatLabel>Dimensions</StatLabel>
            <StatValue>{cube.dimensions?.length ?? 0}</StatValue>
          </div>
          <div>
            <StatLabel>Measures</StatLabel>
            <StatValue>{cube.measures?.length ?? 0}</StatValue>
          </div>
        </StatsRow>
      </Card>

      <Card>
        <SectionHead>
          <Hash size={13} color="var(--text-secondary)" />
          Schema · top columns
        </SectionHead>
        {visibleCols.length === 0 ? (
          <div style={{ padding: 14, fontSize: 12.5, color: 'var(--text-muted)' }}>No columns.</div>
        ) : (
          visibleCols.map((c) => (
            <ColumnRow key={c.name}>
              {typeIcon(c.type)}
              <ColumnName>{c.name.split('.').slice(-1)[0]}</ColumnName>
              <ColumnType>{c.type ?? '—'}</ColumnType>
            </ColumnRow>
          ))
        )}
        {allCols.length > TOP_N && (
          <MoreBtn type="button" onClick={() => setExpanded((s) => !s)}>
            {expanded ? (
              <>Show top {TOP_N}</>
            ) : (
              <>
                + {remaining} more columns <ChevronDown size={12} />
              </>
            )}
          </MoreBtn>
        )}
      </Card>

      <Card>
        <TypeCardBody>
          <TypeCardLabel>Columns by type</TypeCardLabel>
          {total === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No type info.</div>
          ) : (
            <>
              <Bar>
                {types.map(([k, n]) => (
                  <Seg key={k} $color={TYPE_COLORS[k] ?? TYPE_COLORS.other} style={{ flex: n }} />
                ))}
              </Bar>
              <Legend>
                {types.map(([k, n]) => (
                  <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        background: TYPE_COLORS[k] ?? TYPE_COLORS.other,
                        borderRadius: 2,
                      }}
                    />
                    {k} · {n}
                  </span>
                ))}
              </Legend>
            </>
          )}
        </TypeCardBody>
      </Card>
    </>
  );
}
