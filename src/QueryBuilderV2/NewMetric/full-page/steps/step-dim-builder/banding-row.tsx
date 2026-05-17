import styled from 'styled-components';
import { X } from 'lucide-react';
import type { BandingRow as BandingRowType } from '../../../types';

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 8px;
`;
const Sql = styled.input`
  flex: 1;
  background: var(--bg-muted);
  border: 1px solid var(--border-card);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12.5px;
  font-family: var(--font-mono);
  &:focus { border-color: var(--brand); outline: none; }
`;
const When = styled.span`
  font-size: 11.5px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;
const LabelInput = styled.input`
  flex: 0 0 160px;
  background: var(--bg-muted);
  border: 1px solid var(--border-card);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12.5px;
  font-family: var(--font-mono);
  &:focus { border-color: var(--brand); outline: none; }
`;
const Remove = styled.button`
  background: none;
  border: none;
  color: var(--danger);
  cursor: pointer;
  padding: 4px;
  &:hover { color: var(--brand-hover); }
`;

export type BandingRowEditorProps = {
  row: BandingRowType;
  onChange: (patch: Partial<BandingRowType>) => void;
  onRemove: () => void;
};

export function BandingRowEditor({ row, onChange, onRemove }: BandingRowEditorProps) {
  return (
    <Row>
      <Sql
        value={row.sql}
        placeholder="{CUBE}.ltv_vnd >= 10000000"
        onChange={(e) => onChange({ sql: e.target.value })}
      />
      <When>when</When>
      <LabelInput
        value={row.label}
        placeholder="whale"
        onChange={(e) => onChange({ label: e.target.value })}
      />
      <Remove onClick={onRemove} aria-label="Remove band" type="button">
        <X size={14} />
      </Remove>
    </Row>
  );
}
