/**
 * Left pane of the Drift Center master–detail layout: a scannable, selectable
 * list of every root-cause group for the active game, with the background
 * detector's last-run log pinned beneath it. Selecting a row drives the resolve
 * pane on the right. The detector log is shown SEPARATELY (never merged) because
 * it reconciles against the local game_id workspace, which can differ from the
 * workspace being viewed.
 */
import { ReactElement } from 'react';
import styled from 'styled-components';
import type { DetectorPanel, RootCauseGroup } from './use-drift-center';
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

const DetectorWrap = styled.div`
  margin-top: 20px;
  padding-top: 14px;
  border-top: 1px dashed var(--border-strong);
`;
const DetectorRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 12px;
  border-bottom: 1px dashed var(--border-card);
  &:last-child { border-bottom: none; }
  & code { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
const DetectorReason = styled.span`
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
`;
const Src = styled.div`
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-muted);
`;

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface Props {
  groups: RootCauseGroup[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  detector: DetectorPanel;
}

/** Stable identity for a group row (reason + key) — matches index.tsx keying. */
export function groupKey(g: RootCauseGroup): string {
  return `${g.reason}:${g.key}`;
}

export function RootCauseList({ groups, selectedKey, onSelect, detector }: Props): ReactElement {
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

      {detector.groups.length ? (
        <DetectorWrap>
          <SectionLabel>Detector log</SectionLabel>
          {detector.groups.map((g) => (
            <DetectorRow key={`${g.reason}:${g.key}`}>
              <code title={g.key}>{g.key}</code>
              <DetectorReason>
                {g.affectedCount} metric{g.affectedCount === 1 ? '' : 's'}
              </DetectorReason>
            </DetectorRow>
          ))}
          <Src>source: anomaly-detector · local · {fmtTime(detector.updatedAt)}</Src>
        </DetectorWrap>
      ) : null}
    </Wrap>
  );
}
