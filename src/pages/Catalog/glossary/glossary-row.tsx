/**
 * Single row in the glossary index. Clicking the term navigates to the
 * existing concept-detail page when a `primaryCatalogId` is wired.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import type { GlossaryTerm } from '../../../api/glossary-client';
import { resolveGlossaryHref } from './resolve-glossary-link';

interface Props {
  term: GlossaryTerm;
}

const Row = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-subtle);
`;

const TopLine = styled.div`
  display: flex;
  align-items: baseline;
  gap: 10px;
`;

const Label = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
`;

const CategoryTag = styled.span`
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--bg-muted);
`;

const Description = styled.div`
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
`;

const Aliases = styled.div`
  font-size: 11px;
  color: var(--text-muted);
`;

const CatalogChip = styled(Link)`
  align-self: flex-start;
  margin-top: 4px;
  font-size: 11.5px;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--brand-soft, rgba(240,90,34,0.1));
  color: var(--brand, #f05a22);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

export function GlossaryRow({ term }: Props) {
  // Bound terms (e.g. dau, mau) link to /catalog/metric/<slug>; unbound terms
  // (cohort, funnel, engagement) have no chip and stay as definition-only rows.
  const href = term.primaryCatalogId ? resolveGlossaryHref(term) : null;
  return (
    <Row data-glossary-id={term.id}>
      <TopLine>
        <Label>{term.label}</Label>
        {term.category ? <CategoryTag>{term.category}</CategoryTag> : null}
      </TopLine>
      <Description>{term.description}</Description>
      {term.aliases.length > 0 ? (
        <Aliases>aka: {term.aliases.join(', ')}</Aliases>
      ) : null}
      {href ? <CatalogChip to={href}>{term.primaryCatalogId}</CatalogChip> : null}
    </Row>
  );
}
