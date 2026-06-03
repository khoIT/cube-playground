/**
 * ConceptRelationsSection — renders reverse-edge sections inside MemberDetailPanel.
 *
 * Fetches cross-layer relations for a data_model ref (e.g. "data_model/mf_users.dau")
 * using the module-cached useConceptResolution hook, then renders ConceptChips for:
 *   - metrics that use this field
 *   - glossary terms that define this field
 *   - app segments that filter on this field
 *
 * Layer visibility is controlled by the `visibleLayers` prop so the parent's
 * filter-pill state gates which sections render.
 */
import React from 'react';
import styled from 'styled-components';
import { useConceptResolution } from '../../../components/concept-hover-card/use-concept-resolution';
import { ConceptChip } from '../../../components/concept-chip/concept-chip';
import type { LayerFilter } from './layer-filter-pills';

interface Props {
  /** Full namespaced concept ref, e.g. "data_model/mf_users.dau". */
  conceptRef: string;
  /** Set of layer sections to show. */
  visibleLayers: ReadonlySet<LayerFilter>;
}

const SectionWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const SectionLabel = styled.div`
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: 4px;
`;

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const EmptyNote = styled.div`
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
`;

const LoadingNote = styled.div`
  font-size: 12px;
  color: var(--text-muted);
`;

export function ConceptRelationsSection({ conceptRef, visibleLayers }: Props) {
  const { data, loading, error } = useConceptResolution(conceptRef);

  if (loading) {
    return <LoadingNote>Loading relations…</LoadingNote>;
  }

  if (error || !data) {
    // Silently degrade — relations are supplementary; don't block the panel.
    return null;
  }

  const showMetrics = visibleLayers.has('metrics');
  const showGlossary = visibleLayers.has('glossary');
  const showSegments = visibleLayers.has('segments');

  const hasMetrics = data.metrics.length > 0;
  const hasTerms = data.terms.length > 0;
  const hasSegments = data.segments.length > 0;

  // If no layer is toggled on or there's nothing to show, render nothing.
  if (!showMetrics && !showGlossary && !showSegments) return null;

  return (
    <SectionWrap>
      {showMetrics && (
        <div>
          <SectionLabel>Used by metrics</SectionLabel>
          {hasMetrics ? (
            <ChipRow>
              {data.metrics.map((m) => (
                <ConceptChip
                  key={m.ref}
                  kind="metric"
                  label={m.label}
                  trust={m.trust}
                  to={`/catalog/metric/${encodeURIComponent(m.id)}`}
                  title={`View metric: ${m.label}`}
                />
              ))}
            </ChipRow>
          ) : (
            <EmptyNote>No metrics reference this field.</EmptyNote>
          )}
        </div>
      )}

      {showGlossary && (
        <div>
          <SectionLabel>Defined as terms</SectionLabel>
          {hasTerms ? (
            <ChipRow>
              {data.terms.map((t) => (
                <ConceptChip
                  key={t.ref}
                  kind="concept"
                  label={t.label}
                  trust={t.trust}
                  to={`/catalog/glossary#${encodeURIComponent(t.id)}`}
                  title={`View glossary term: ${t.label}`}
                />
              ))}
            </ChipRow>
          ) : (
            <EmptyNote>No glossary terms define this field.</EmptyNote>
          )}
        </div>
      )}

      {showSegments && (
        <div>
          <SectionLabel>Segments filtering this</SectionLabel>
          {hasSegments ? (
            <ChipRow>
              {data.segments.map((s) => (
                <ConceptChip
                  key={s.ref}
                  kind="segment"
                  label={s.name}
                  to={`/segments/${encodeURIComponent(s.id)}`}
                  title={`View segment: ${s.name}`}
                  // Segments are user-built facts — certified by construction
                  // (a predicate either matches rows or not), so the badge is
                  // a constant rather than a per-row field on the server type.
                  trust="certified"
                />
              ))}
            </ChipRow>
          ) : (
            <EmptyNote>No segments filter on this field.</EmptyNote>
          )}
        </div>
      )}
    </SectionWrap>
  );
}
