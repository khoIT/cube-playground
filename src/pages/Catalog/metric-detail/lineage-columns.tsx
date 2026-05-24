/**
 * LineageColumns — 3-column flow: upstream cubes/members ← this metric →
 * downstream metrics. Upstream cards are grouped by cube so multi-ref
 * formulas read as one tile per source. Downstream cards are clickable.
 */

import { Link } from 'react-router-dom';
import styled, { css } from 'styled-components';

import type { Lineage, LineageRef } from './lineage-graph-builder';

const Cols = styled.div`
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 28px;
  padding: 20px 24px 28px;
  align-items: stretch;
`;

const Col = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const ColHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
`;

const ColTitle = styled.h4`
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted, #737373);
`;

const Pill = styled.span`
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-secondary, #525252);
  font-weight: 500;
`;

const cardStyles = css`
  padding: 12px 14px;
  border: 1px solid var(--border-card, #e5e5e5);
  border-radius: 10px;
  background: var(--bg-card, #ffffff);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
`;

const UpstreamCard = styled.div`
  ${cardStyles}
  border-left: 3px solid #3f8dff;
`;

const UpstreamCube = styled.div`
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #171717);
  margin-bottom: 4px;
`;

const UpstreamMembers = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const UpstreamMember = styled.li`
  font-family: var(--font-mono, monospace);
  font-size: 11.5px;
  color: var(--text-muted, #737373);
`;

const DownstreamCard = styled(Link)`
  ${cardStyles}
  display: block;
  text-decoration: none;
  color: inherit;
  border-left: 3px solid #22c55e;

  &:hover {
    border-color: var(--brand, #f05a22);
    box-shadow: 0 1px 4px rgba(240, 90, 34, 0.12);
  }
`;

const DownstreamLabel = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #171717);
  margin-bottom: 2px;
`;

const DownstreamVia = styled.small`
  font-family: var(--font-mono, monospace);
  font-size: 11.5px;
  color: var(--text-muted, #737373);
`;

const HubWrap = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
`;

const Hub = styled.div`
  padding: 16px 20px;
  border: 2px solid var(--brand, #f05a22);
  border-radius: 12px;
  background: rgba(240, 90, 34, 0.06);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #171717);
  text-align: center;
  box-shadow: 0 1px 4px rgba(240, 90, 34, 0.12);
`;

const HubSub = styled.small`
  display: block;
  font-weight: 400;
  opacity: 0.7;
  margin-top: 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
`;

const Arrow = styled.span<{ direction: 'left' | 'right' }>`
  font-size: 18px;
  color: var(--text-muted, #b3b3b3);
  ${({ direction }) => (direction === 'left' ? 'transform: rotate(180deg);' : '')}
`;

const ConnectorRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted, #737373);
`;

const Empty = styled.div`
  padding: 14px;
  border: 1px dashed var(--border-card, #d4d4d4);
  border-radius: 10px;
  font-size: 12px;
  color: var(--text-muted, #737373);
  font-style: italic;
  text-align: center;
`;

interface LineageColumnsProps {
  lineage: Lineage;
  metricLabel: string;
}

interface UpstreamGroup {
  cube: string;
  members: string[];
}

function groupUpstreamByCube(refs: LineageRef[]): UpstreamGroup[] {
  const map = new Map<string, string[]>();
  for (const ref of refs) {
    const existing = map.get(ref.cube) ?? [];
    if (ref.member && !existing.includes(ref.member)) existing.push(ref.member);
    map.set(ref.cube, existing);
  }
  return Array.from(map.entries()).map(([cube, members]) => ({ cube, members }));
}

export function LineageColumns({ lineage, metricLabel }: LineageColumnsProps) {
  const groups = groupUpstreamByCube(lineage.upstream);

  return (
    <Cols>
      <Col>
        <ColHeader>
          <ColTitle>Upstream</ColTitle>
          <Pill>{groups.length} {groups.length === 1 ? 'source' : 'sources'}</Pill>
        </ColHeader>
        {groups.length === 0 ? (
          <Empty>No upstream refs.</Empty>
        ) : (
          groups.map((g) => (
            <UpstreamCard key={g.cube}>
              <UpstreamCube>{g.cube}</UpstreamCube>
              {g.members.length > 0 && (
                <UpstreamMembers>
                  {g.members.map((m) => (
                    <UpstreamMember key={m}>· {m}</UpstreamMember>
                  ))}
                </UpstreamMembers>
              )}
            </UpstreamCard>
          ))
        )}
      </Col>

      <HubWrap>
        <ConnectorRow>
          <Arrow direction="right" aria-hidden>→</Arrow>
          <span>feeds</span>
        </ConnectorRow>
        <Hub>
          {metricLabel}
          <HubSub>this metric</HubSub>
        </Hub>
        <ConnectorRow>
          <span>used by</span>
          <Arrow direction="right" aria-hidden>→</Arrow>
        </ConnectorRow>
      </HubWrap>

      <Col>
        <ColHeader>
          <ColTitle>Downstream</ColTitle>
          <Pill>
            {lineage.downstream.length} {lineage.downstream.length === 1 ? 'metric' : 'metrics'}
          </Pill>
        </ColHeader>
        {lineage.downstream.length === 0 ? (
          <Empty>No downstream metrics yet.</Empty>
        ) : (
          lineage.downstream.map(({ metric, via }) => (
            <DownstreamCard key={metric.id} to={`/catalog/metric/${metric.id}`}>
              <DownstreamLabel>{metric.label}</DownstreamLabel>
              <DownstreamVia>via {via}</DownstreamVia>
            </DownstreamCard>
          ))
        )}
      </Col>
    </Cols>
  );
}
