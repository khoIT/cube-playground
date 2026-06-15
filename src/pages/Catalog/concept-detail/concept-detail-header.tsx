/**
 * ConceptDetailHeader — title row + type icon. Mirrors MetricDetailHeader
 * visually but takes a generic Concept instead of a BusinessMetric. Parent
 * trail is rendered by the global topbar breadcrumb.
 */

import styled from 'styled-components';

import { FreshnessChip } from '../../../shared/concept-shell/freshness-chip';
import { TypeIcon } from '../../../shared/concept-shell/type-icon';
import { useFreshness } from '../../../shared/concept-shell/use-freshness';
import type { Concept } from '../data-model-tab/concept-types';

const Header = styled.header`
  padding: 16px 24px 12px;
  border-bottom: 1px solid var(--border-card);
  background: var(--bg-app, transparent);
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
  color: var(--text-primary);
  font-family: var(--font-mono, monospace);
`;

const TypeTag = styled.span`
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
`;

const Description = styled.p`
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
  max-width: 720px;
`;

export function ConceptDetailHeader({ concept }: { concept: Concept }) {
  const { state: freshness } = useFreshness(concept.cube);
  return (
    <Header>
      <TitleRow>
        <TypeIcon kind={concept.type} />
        <Title>{concept.fqn}</Title>
        <TypeTag>{concept.type}</TypeTag>
        <FreshnessChip state={freshness} />
      </TitleRow>
      {(concept.description || concept.title) && (
        <Description>{concept.description ?? concept.title}</Description>
      )}
    </Header>
  );
}
