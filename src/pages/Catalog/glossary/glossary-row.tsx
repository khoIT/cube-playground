/**
 * Single row in the glossary index. Clicking the term navigates to the
 * existing concept-detail page when a `primaryCatalogId` is wired; an edit
 * affordance launches the modal so analysts can author or refine terms in
 * place. A small Draft/Official pill flags publication state at a glance.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { Pencil } from 'lucide-react';
import type { GlossaryTerm } from '../../../api/glossary-client';
import { isConceptTerm } from '../../../api/glossary-client';
import { resolveGlossaryHref } from './resolve-glossary-link';

interface Props {
  term: GlossaryTerm;
  onEdit?: (term: GlossaryTerm) => void;
  editLabel?: string;
  draftLabel?: string;
  officialLabel?: string;
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

const LabelVi = styled.div`
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
`;

const Spacer = styled.div`
  flex: 1;
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

const StatusPill = styled.span<{ $official: boolean }>`
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 8px;
  border-radius: var(--radius-pill, 999px);
  background: ${(p) => (p.$official ? 'var(--brand-soft, rgba(240,90,34,0.1))' : 'var(--bg-muted)')};
  color: ${(p) => (p.$official ? 'var(--brand)' : 'var(--text-muted)')};
`;

const EditBtn = styled.button`
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  padding: 4px;
  border-radius: 3px;
  cursor: pointer;
  &:hover { color: var(--brand); border-color: var(--border-card); }
`;

const Description = styled.div`
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
`;

const DescriptionVi = styled.div`
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
`;

const Aliases = styled.div`
  font-size: 11px;
  color: var(--text-muted);
`;

/** Small badge shown on rows that carry at least one concept-tier field. */
const ConceptBadge = styled.span`
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--info-soft, rgba(59,130,246,0.12));
  color: var(--info-ink, #2563eb);
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

export function GlossaryRow({ term, onEdit, editLabel, draftLabel, officialLabel }: Props) {
  const href = term.primaryCatalogId ? resolveGlossaryHref(term) : null;
  const allAliases = [...term.aliases, ...term.aliasesVi];
  return (
    <Row data-glossary-id={term.id}>
      <TopLine>
        <Label>{term.label}</Label>
        {term.labelVi ? <LabelVi>· {term.labelVi}</LabelVi> : null}
        {term.category ? <CategoryTag>{term.category}</CategoryTag> : null}
        {isConceptTerm(term) ? <ConceptBadge title={`Entity: ${term.entityCube ?? '—'}`}>concept</ConceptBadge> : null}
        <StatusPill $official={term.status === 'official'}>
          {term.status === 'official' ? officialLabel ?? 'Official' : draftLabel ?? 'Draft'}
        </StatusPill>
        <Spacer />
        {onEdit ? (
          <EditBtn type="button" aria-label={editLabel ?? 'Edit'} onClick={() => onEdit(term)}>
            <Pencil size={14} aria-hidden />
          </EditBtn>
        ) : null}
      </TopLine>
      <Description>{term.description}</Description>
      {term.descriptionVi ? <DescriptionVi>{term.descriptionVi}</DescriptionVi> : null}
      {allAliases.length > 0 ? <Aliases>aka: {allAliases.join(', ')}</Aliases> : null}
      {href ? <CatalogChip to={href}>{term.primaryCatalogId}</CatalogChip> : null}
    </Row>
  );
}
