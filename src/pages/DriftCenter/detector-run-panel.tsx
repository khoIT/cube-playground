/**
 * "Last detector run saw" — a visually distinct (dashed top rule, muted) panel
 * rendering the background detector's persisted unresolved set. Shown SEPARATELY
 * from the live groups and never merged: the detector reconciles against the
 * local game_id workspace, which can differ from the workspace being viewed.
 */
import { ReactElement } from 'react';
import styled from 'styled-components';
import type { DetectorPanel } from './use-drift-center';

const Wrap = styled.div`
  margin-top: 26px;
  padding-top: 4px;
  border-top: 1px dashed var(--border-strong);
`;
const Head = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 16px 0 10px;
`;
const H2 = styled.h2`
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
`;
const Src = styled.span`
  font-size: 11px;
  color: var(--text-muted);
`;
const Tag = styled.span`
  height: 22px;
  padding: 0 9px;
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-pill);
  background: var(--bg-muted);
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
`;
const Card = styled.div`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  padding: 12px 14px;
`;
const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px dashed var(--border-card);
  font-size: 12.5px;
  &:last-child { border-bottom: none; }
  & code { font-family: var(--font-mono); font-size: 11.5px; color: var(--text-secondary); }
`;
const Reason = styled.span`
  font-size: 12px;
  color: var(--text-muted);
`;
const Count = styled.span`
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  font-size: 12px;
`;
const Lede = styled.p`
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-muted);
  max-width: 64ch;
`;

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface Props {
  panel: DetectorPanel;
}

export function DetectorRunPanel({ panel }: Props): ReactElement | null {
  if (!panel.groups.length) return null;
  return (
    <Wrap>
      <Head>
        <H2>Last detector run saw</H2>
        <Src>source: anomaly-detector · local · {fmtTime(panel.updatedAt)}</Src>
        <Tag>detector</Tag>
      </Head>
      <Card>
        {panel.groups.map((g) => (
          <Row key={`${g.reason}:${g.key}`}>
            <code>{g.key}</code>
            <Reason>{g.reason}</Reason>
            <Count>
              {g.affectedCount} metric{g.affectedCount === 1 ? '' : 's'}
            </Count>
          </Row>
        ))}
      </Card>
      <Lede>
        The background detector reconciles against the local game_id workspace. Shown separately
        because its target can differ from the workspace you’re viewing — never merged into the live
        groups above.
      </Lede>
    </Wrap>
  );
}
