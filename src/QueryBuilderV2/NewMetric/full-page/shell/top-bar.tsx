import styled from 'styled-components';
import { Sparkles, X, Save, HelpCircle } from 'lucide-react';

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
`;

const LeftGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const Brand = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--brand);
`;

const Crumbs = styled.div`
  font-size: 13px;
  color: var(--text-secondary);
  display: flex;
  gap: 6px;
  align-items: center;
`;

const Sep = styled.span`
  color: var(--text-muted);
`;

const RightGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const IconBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border-card);
  background: var(--bg-card);
  color: var(--text-secondary);
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  &:hover { background: var(--bg-muted); }
  &.danger { color: var(--danger); border-color: rgba(239, 68, 68, 0.3); }
`;

export type TopBarProps = {
  onSaveDraft: () => void;
  onDiscard: () => void;
};

export function TopBar({ onSaveDraft, onDiscard }: TopBarProps) {
  return (
    <Row>
      <LeftGroup>
        <Brand>
          <Sparkles size={14} />
          <span>GDS Cube</span>
        </Brand>
        <Crumbs>
          <span>Playground</span><Sep>/</Sep>
          <span>Metrics</span><Sep>/</Sep>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>New metric</span>
        </Crumbs>
      </LeftGroup>
      <RightGroup>
        <IconBtn onClick={onSaveDraft} title="Save draft">
          <Save size={14} /> Save draft
        </IconBtn>
        <IconBtn title="Help">
          <HelpCircle size={14} /> Help
        </IconBtn>
        <IconBtn className="danger" onClick={onDiscard} title="Discard">
          <X size={14} /> Discard
        </IconBtn>
      </RightGroup>
    </Row>
  );
}
