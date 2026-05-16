import { useState } from 'react';
import styled from 'styled-components';
import { Info } from 'lucide-react';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import type { Operation } from '../../../types';
import { useEligibleColumns, EligibleColumn } from '../../hooks/use-eligible-columns';
import { findOp } from '../step-2-operation/operations';

const Bar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
`;
const WhyBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: 1px solid var(--border-card);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12.5px;
  color: var(--text-secondary);
  cursor: pointer;
  &:hover { background: var(--bg-muted); }
`;
const Popup = styled.div`
  position: absolute;
  right: 0;
  top: 100%;
  margin-top: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 10px;
  padding: 12px;
  width: 320px;
  z-index: 10;
  box-shadow: var(--shadow-sm);
  font-size: 12.5px;
`;
const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
`;
const Card = styled.button<{ $selected: boolean }>`
  text-align: left;
  background: var(--bg-card);
  border: 1px solid ${(p) => (p.$selected ? 'var(--brand)' : 'var(--border-card)')};
  border-radius: 12px;
  padding: 14px;
  cursor: pointer;
  &:hover { border-color: var(--brand); }
  box-shadow: ${(p) => (p.$selected ? '0 0 0 3px var(--brand-soft)' : 'none')};
`;
const Name = styled.div`
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 13.5px;
  color: var(--text-primary);
`;
const Type = styled.span`
  margin-left: 6px;
  font-size: 11.5px;
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-weight: 400;
`;
const Desc = styled.div`
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-top: 6px;
`;
const PopRow = styled.div`
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px dashed var(--border-card);
  &:last-child { border-bottom: none; }
`;

export type ColumnBodyProps = {
  cube: WizardCube | null;
  operation: Operation;
  column: string | null;
  onSelect: (col: string) => void;
};

export function ColumnBody({ cube, operation, column, onSelect }: ColumnBodyProps) {
  const def = findOp(operation);
  const { eligible, rejected } = useEligibleColumns(cube, def?.accepts ?? 'all');
  const [popup, setPopup] = useState(false);

  return (
    <>
      <Bar>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {eligible.length} eligible column{eligible.length === 1 ? '' : 's'} for{' '}
          <strong>{def?.name ?? operation}</strong>.
        </div>
        <div style={{ position: 'relative' }}>
          <WhyBtn onClick={() => setPopup((s) => !s)}>
            <Info size={12} /> Why only {eligible.length}?
          </WhyBtn>
          {popup && (
            <Popup>
              <div style={{ marginBottom: 8, fontWeight: 600 }}>
                {def?.name} accepts: {def?.accepts}.
              </div>
              {rejected.length === 0 ? (
                <div style={{ color: 'var(--text-muted)' }}>No rejected columns.</div>
              ) : (
                rejected.slice(0, 8).map((r) => (
                  <PopRow key={r.name}>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{r.name.split('.').slice(-1)[0]}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{r.reason}</span>
                  </PopRow>
                ))
              )}
              {rejected.length > 8 && (
                <div style={{ color: 'var(--text-muted)', marginTop: 6 }}>
                  + {rejected.length - 8} more
                </div>
              )}
            </Popup>
          )}
        </div>
      </Bar>
      <Grid>
        {eligible.map((c: EligibleColumn) => (
          <Card
            key={c.name}
            $selected={column === c.name}
            onClick={() => onSelect(c.name)}
            type="button"
          >
            <Name>
              {c.name.split('.').slice(-1)[0]}
              <Type>{c.type ?? '—'}</Type>
            </Name>
            {c.title && c.title !== c.name && <Desc>{c.title}</Desc>}
          </Card>
        ))}
      </Grid>
    </>
  );
}
