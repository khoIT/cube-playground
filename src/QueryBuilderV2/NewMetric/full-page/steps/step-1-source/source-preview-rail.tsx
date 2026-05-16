import styled from 'styled-components';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';

const Card = styled.div`
  background: var(--bg-muted);
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--border-card);
  margin-bottom: 12px;
`;

const Title = styled.div`
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
`;

const Mono = styled.div`
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
`;

const Section = styled.div`
  margin-top: 16px;
`;

const SectionLabel = styled.div`
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  margin-bottom: 8px;
`;

const ColumnRow = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
  padding: 4px 0;
  border-bottom: 1px dashed var(--border-card);
  &:last-child { border-bottom: none; }
`;
const ColumnName = styled.span`
  font-family: var(--font-mono);
  color: var(--text-primary);
`;
const ColumnType = styled.span`
  color: var(--text-muted);
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
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-secondary);
  margin-top: 6px;
`;

const SWATCH = ['#f05a22', '#3f8dff', '#009688', '#f59e0b', '#a855f7', '#737373'];

function classify(t: string | undefined): string {
  if (!t) return 'other';
  const lo = t.toLowerCase();
  if (lo === 'number' || lo === 'integer') return 'number';
  if (lo === 'string') return 'string';
  if (lo === 'time' || lo === 'date') return 'time';
  if (lo === 'boolean') return 'boolean';
  return 'other';
}

export function SourcePreviewRail({ cube }: { cube: WizardCube | null }) {
  if (!cube) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        Pick a source to see its columns and type distribution.
      </div>
    );
  }

  const allCols = [...(cube.dimensions ?? []), ...(cube.measures ?? []).map((m) => ({
    name: m.name, title: m.title, type: m.aggType,
  }))];
  const top = allCols.slice(0, 6);

  const counts: Record<string, number> = {};
  for (const c of cube.dimensions ?? []) {
    const k = classify(c.type);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const types = Object.entries(counts);

  return (
    <>
      <Card>
        <Title>{cube.title || cube.name}</Title>
        <Mono>{cube.name}{cube.type === 'view' ? ' (view)' : ''}</Mono>
      </Card>
      <Section>
        <SectionLabel>Schema · top columns</SectionLabel>
        {top.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No columns.</div>}
        {top.map((c) => (
          <ColumnRow key={c.name}>
            <ColumnName>{c.name.split('.').slice(-1)[0]}</ColumnName>
            <ColumnType>{c.type ?? '—'}</ColumnType>
          </ColumnRow>
        ))}
      </Section>
      <Section>
        <SectionLabel>Columns by type</SectionLabel>
        {total === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No type info.</div>
        ) : (
          <>
            <Bar>
              {types.map(([k, n], i) => (
                <Seg key={k} $color={SWATCH[i % SWATCH.length]} style={{ flex: n }} />
              ))}
            </Bar>
            <Legend>
              {types.map(([k, n], i) => (
                <span key={k}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, background: SWATCH[i % SWATCH.length], borderRadius: 2, marginRight: 4 }} />
                  {k} · {n}
                </span>
              ))}
            </Legend>
          </>
        )}
      </Section>
    </>
  );
}
