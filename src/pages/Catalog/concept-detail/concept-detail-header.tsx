/**
 * ConceptDetailHeader — title row + breadcrumb + type icon. Mirrors
 * MetricDetailHeader visually but takes a generic Concept instead of a
 * BusinessMetric.
 */

import { Link } from 'react-router-dom';
import styled from 'styled-components';

import { TypeIcon } from '../../../shared/concept-shell/type-icon';
import type { Concept } from '../data-model-tab/concept-types';

const Header = styled.header`
  padding: 16px 24px 12px;
  border-bottom: 1px solid var(--border-card, #e5e5e5);
  background: var(--bg-app, transparent);
`;

const Breadcrumb = styled.div`
  font-size: 12px;
  color: var(--text-muted, #737373);
  margin-bottom: 8px;

  a {
    color: var(--brand, #f05a22);
    text-decoration: none;
  }
  a:hover { text-decoration: underline; }
`;

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--text-primary, #171717);
  font-family: var(--font-mono, monospace);
`;

const TypeTag = styled.span`
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted, #737373);
`;

const Description = styled.p`
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--text-secondary, #525252);
  max-width: 720px;
`;

export function ConceptDetailHeader({ concept }: { concept: Concept }) {
  return (
    <Header>
      <Breadcrumb>
        <Link to="/catalog/data-model">Catalog</Link> · Data Model · {concept.cube} ·{' '}
        <code>{concept.name}</code>
      </Breadcrumb>
      <TitleRow>
        <TypeIcon kind={concept.type} />
        <Title>{concept.fqn}</Title>
        <TypeTag>{concept.type}</TypeTag>
      </TitleRow>
      {(concept.description || concept.title) && (
        <Description>{concept.description ?? concept.title}</Description>
      )}
    </Header>
  );
}
