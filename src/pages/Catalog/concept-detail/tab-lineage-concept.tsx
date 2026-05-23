/**
 * Concept Lineage tab — upstream cube on the left, this concept at hub,
 * downstream business metrics on the right (filtered to those whose
 * formula refs include this concept's FQN).
 */

import { Link } from 'react-router-dom';
import styled from 'styled-components';

import type { BusinessMetric } from '../metrics-tab/business-metric-types';
import type { Concept } from '../data-model-tab/concept-types';
import { extractFormulaRefs } from '../metric-detail/lineage-graph-builder';

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

const Item = styled.div`
  padding: 10px 12px;
  border: 1px solid var(--border-card, #e5e5e5);
  border-radius: 8px;
  background: var(--bg-card, #ffffff);
  margin-bottom: 8px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
`;

const LinkItem = styled(Link)`
  display: block;
  padding: 10px 12px;
  border: 1px solid var(--border-card, #e5e5e5);
  border-radius: 8px;
  background: var(--bg-card, #ffffff);
  margin-bottom: 8px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: inherit;
  text-decoration: none;
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
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #171717);
  font-family: var(--font-mono, monospace);
`;

const Empty = styled.div`
  font-size: 12px;
  color: var(--text-muted, #737373);
  font-style: italic;
`;

interface TabLineageConceptProps {
  concept: Concept;
  businessMetrics: BusinessMetric[];
}

export function TabLineageConcept({ concept, businessMetrics }: TabLineageConceptProps) {
  const downstream = businessMetrics.filter((m) =>
    extractFormulaRefs(m).includes(concept.fqn),
  );

  return (
    <Cols>
      <Col>
        <ColTitle>Upstream cube</ColTitle>
        <Item>
          <div>{concept.cube}</div>
          {concept.meta?.source && (
            <small style={{ color: '#737373' }}>{concept.meta.source}</small>
          )}
        </Item>
      </Col>
      <Hub>
        {concept.fqn}
        <small style={{ fontWeight: 400, opacity: 0.7 }}>this {concept.type}</small>
      </Hub>
      <Col>
        <ColTitle>Downstream metrics ({downstream.length})</ColTitle>
        {downstream.length === 0 ? (
          <Empty>No business metrics reference this concept yet.</Empty>
        ) : (
          downstream.map((m) => (
            <LinkItem key={m.id} to={`/catalog/metric/${m.id}`}>
              <div>{m.label}</div>
              <small style={{ color: '#737373' }}>{m.id}</small>
            </LinkItem>
          ))
        )}
      </Col>
    </Cols>
  );
}
