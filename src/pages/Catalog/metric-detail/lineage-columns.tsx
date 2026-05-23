/**
 * LineageColumns — 3-column layout: upstream cubes/members ← this metric →
 * downstream metrics. Downstream is clickable; upstream is informational
 * (per-cube detail navigation arrives with P5).
 */

import { Link } from 'react-router-dom';
import styled, { css } from 'styled-components';

import type { Lineage } from './lineage-graph-builder';

const Cols = styled.div`
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 24px;
  padding: 20px 24px;
  align-items: start;
`;

const Col = styled.div``;

const ColTitle = styled.h4`
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted, #737373);
`;

const itemStyles = css`
  padding: 10px 12px;
  border: 1px solid var(--border-card, #e5e5e5);
  border-radius: 8px;
  background: var(--bg-card, #ffffff);
  margin-bottom: 8px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
`;

const Item = styled.div`
  ${itemStyles}
`;

const LinkItem = styled(Link)`
  ${itemStyles}
  display: block;
  text-decoration: none;
  color: inherit;
`;

const Hub = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 16px;
  border: 2px solid var(--brand, #f05a22);
  border-radius: 10px;
  background: rgba(240, 90, 34, 0.05);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #171717);
`;

const Empty = styled.div`
  font-size: 12px;
  color: var(--text-muted, #737373);
  font-style: italic;
`;

interface LineageColumnsProps {
  lineage: Lineage;
  metricLabel: string;
}

export function LineageColumns({ lineage, metricLabel }: LineageColumnsProps) {
  return (
    <Cols>
      <Col>
        <ColTitle>Upstream ({lineage.upstream.length})</ColTitle>
        {lineage.upstream.length === 0 ? (
          <Empty>No upstream refs.</Empty>
        ) : (
          lineage.upstream.map((ref) => (
            <Item key={ref.fqn}>
              <div>{ref.cube}</div>
              {ref.member && <small style={{ color: '#737373' }}>{ref.member}</small>}
            </Item>
          ))
        )}
      </Col>
      <Hub>
        {metricLabel}
        <small style={{ fontWeight: 400, opacity: 0.7 }}>this metric</small>
      </Hub>
      <Col>
        <ColTitle>Downstream ({lineage.downstream.length})</ColTitle>
        {lineage.downstream.length === 0 ? (
          <Empty>No downstream metrics yet.</Empty>
        ) : (
          lineage.downstream.map(({ metric, via }) => (
            <LinkItem key={metric.id} to={`/catalog/metric/${metric.id}`}>
              <div>{metric.label}</div>
              <small style={{ color: '#737373' }}>via {via}</small>
            </LinkItem>
          ))
        )}
      </Col>
    </Cols>
  );
}
