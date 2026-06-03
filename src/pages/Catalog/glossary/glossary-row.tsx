/**
 * Single row in the glossary index. Clicking the term navigates to the
 * existing concept-detail page when a `primaryCatalogId` is wired; an edit
 * affordance launches the modal so analysts can author or refine terms in
 * place. A small Draft/Official pill flags publication state at a glance.
 */
import React from 'react';
import styled from 'styled-components';
import { Pencil } from 'lucide-react';
import type { GlossaryTerm } from '../../../api/glossary-client';
import { resolveConceptHref } from './resolve-concept';
import { wiringFacetOf } from './glossary-filter';
import { ConceptChip } from '../../../components/concept-chip/concept-chip';
import { ConceptHoverCard } from '../../../components/concept-hover-card/concept-hover-card';

interface Props {
  term: GlossaryTerm;
  onEdit?: (term: GlossaryTerm) => void;
  /** Click the category facet to toggle it in the index filter. */
  onSelectCategory?: (category: string) => void;
  /** Whether this row's category is currently an active filter. */
  categoryActive?: boolean;
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

/**
 * Category is a taxonomy facet (what the term is filed under / can be filtered
 * by), NOT a state badge. Styled deliberately unlike the filled concept/status
 * badges: outlined, lowercase, hash-prefixed — the visual vocabulary of a tag
 * rather than a status. This stops a category like "segments" from reading as a
 * link to the Segments feature.
 */
const CategoryTag = styled.button<{ $active: boolean }>`
  font-family: var(--font-sans);
  font-size: 11px;
  text-transform: lowercase;
  color: ${(p) => (p.$active ? 'var(--brand)' : 'var(--text-muted)')};
  padding: 1px 8px;
  border-radius: var(--radius-pill, 999px);
  border: 1px solid ${(p) => (p.$active ? 'var(--brand)' : 'var(--border-card)')};
  background: ${(p) => (p.$active ? 'var(--brand-soft, rgba(240,90,34,0.1))' : 'transparent')};
  cursor: pointer;

  &:hover {
    border-color: var(--brand);
    color: var(--brand);
  }

  &::before {
    content: '#';
    opacity: 0.55;
    margin-right: 1px;
  }
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

// CatalogChip replaced by the shared ConceptChip component.

export function GlossaryRow({
  term,
  onEdit,
  onSelectCategory,
  categoryActive = false,
  editLabel,
  draftLabel,
  officialLabel,
}: Props) {
  const href = resolveConceptHref(term);
  // Show the destination chip only when the term routes somewhere other than
  // its own anchored row (i.e. a metric or a pre-filtered Build query). Filter-
  // only concept terms route to their own glossary row, so they get no chip here.
  const chipHref = href.startsWith('/catalog/glossary#') ? null : href;
  // Determine kind for the chip: metric when primaryCatalogId is business_metrics/*,
  // otherwise concept for general glossary terms.
  const chipKind = term.primaryCatalogId?.startsWith('business_metrics/') ? 'metric' : 'concept';
  const chipLabel = term.primaryCatalogId?.startsWith('business_metrics/')
    ? (term.primaryCatalogId.replace('business_metrics/', '') || 'metric')
    : term.defaultMeasureRef ?? 'Open in Build';
  const allAliases = [...term.aliases, ...term.aliasesVi];
  return (
    <Row data-glossary-id={term.id}>
      <TopLine>
        {/* Wrap the label in a hover-card so concept details surface on hover. */}
        <ConceptHoverCard term={term}>
          <Label>{term.label}</Label>
        </ConceptHoverCard>
        {term.labelVi ? <LabelVi>· {term.labelVi}</LabelVi> : null}
        {/* State badges sit by the name (what the term IS); the category facet
            is pushed past the spacer below (where it's FILED). */}
        {wiringFacetOf(term) === 'wired' ? (
          <ConceptBadge
            title={`Wired — resolves to ${term.entityCube ?? term.primaryCatalogId ?? term.defaultMeasureRef ?? 'live data'}`}
          >
            Wired
          </ConceptBadge>
        ) : null}
        <StatusPill $official={term.status === 'official'}>
          {term.status === 'official' ? officialLabel ?? 'Official' : draftLabel ?? 'Draft'}
        </StatusPill>
        <Spacer />
        {term.category ? (
          <CategoryTag
            type="button"
            $active={categoryActive}
            aria-pressed={categoryActive}
            title={categoryActive ? `Remove "${term.category}" filter` : `Filter by "${term.category}"`}
            onClick={() => onSelectCategory?.(term.category as string)}
          >
            {term.category}
          </CategoryTag>
        ) : null}
        {onEdit ? (
          <EditBtn type="button" aria-label={editLabel ?? 'Edit'} onClick={() => onEdit(term)}>
            <Pencil size={14} aria-hidden />
          </EditBtn>
        ) : null}
      </TopLine>
      <Description>{term.description}</Description>
      {term.descriptionVi ? <DescriptionVi>{term.descriptionVi}</DescriptionVi> : null}
      {allAliases.length > 0 ? <Aliases>aka: {allAliases.join(', ')}</Aliases> : null}
      {/* ConceptChip replaces the old ad-hoc CatalogChip; trust badge surfaces certified/draft. */}
      {chipHref ? (
        <ConceptChip kind={chipKind} label={chipLabel} to={chipHref} trust={term.trust} />
      ) : null}
    </Row>
  );
}
