/**
 * Left pane of the Drift Center "Resolve" tab: a scannable, selectable list of
 * every root-cause group for the active game. Selecting a row drives the resolve
 * pane on the right. (Detector run history lives in its own "Detector runs" tab.)
 */
import { ReactElement } from 'react';
import styled from 'styled-components';
import type { RootCauseGroup } from './use-drift-center';
import { ReasonPill, REASON_LABEL } from './reason-pill';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
`;
const SectionLabel = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin: 0 0 10px;
`;
const Count = styled.span`
  font-variant-numeric: tabular-nums;
`;
const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;
const Row = styled.li<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 11px;
  border: 1px solid ${(p) => (p.$active ? 'var(--brand)' : 'var(--border-card)')};
  border-left: 3px solid ${(p) => (p.$active ? 'var(--brand)' : 'transparent')};
  border-radius: var(--radius-md);
  background: ${(p) => (p.$active ? 'var(--brand-soft)' : 'var(--bg-card)')};
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
  &:hover { background: ${(p) => (p.$active ? 'var(--brand-soft)' : 'var(--bg-muted)')}; }
`;
const RowKey = styled.span`
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
`;
const RowCount = styled.span`
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
`;
const MiniPill = styled(ReasonPill)`
  flex-shrink: 0;
  height: 18px;
  padding: 0 7px;
  font-size: 10px;
`;

interface Props {
  groups: RootCauseGroup[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

/** Stable identity for a group row (reason + key) — matches index.tsx keying. */
export function groupKey(g: RootCauseGroup): string {
  return `${g.reason}:${g.key}`;
}

export function RootCauseList({ groups, selectedKey, onSelect }: Props): ReactElement {
  return (
    <Wrap>
      <SectionLabel>
        Root causes <Count>({groups.length})</Count>
      </SectionLabel>
      <List>
        {groups.map((g) => {
          const k = groupKey(g);
          return (
            <Row
              key={k}
              $active={k === selectedKey}
              onClick={() => onSelect(k)}
              role="button"
              aria-pressed={k === selectedKey}
            >
              <RowKey title={g.key}>{g.key}</RowKey>
              <RowCount>{g.affectedCount}</RowCount>
              <MiniPill $tone={g.reason}>{REASON_LABEL[g.reason]}</MiniPill>
            </Row>
          );
        })}
      </List>
    </Wrap>
  );
}
