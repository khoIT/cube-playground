/**
 * Right rail for ConceptDetailPage. Action enablement is type-aware:
 *
 *  • measure   → Open in Explore (live), Push to activation (stub),
 *                Subscribe (stub), Edit (stub).
 *  • dimension → Open in Explore (live, dim as breakdown without measures
 *                isn't useful — keep stubbed), rest stubbed.
 *  • segment   → Push to activation (live, segment IS the payload),
 *                rest stubbed.
 */

import { useHistory } from 'react-router-dom';
import styled from 'styled-components';

import type { Concept } from '../data-model-tab/concept-types';
import { useCatalogMeta } from '../use-catalog-meta';
import { buildConceptExploreUrl } from '../metric-detail/explore-query-builder';

const Rail = styled.aside`
  width: 240px;
  padding: 16px 14px;
  border-left: 1px solid var(--border-card, #e5e5e5);
  background: var(--bg-card, #ffffff);
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Button = styled.button`
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border-card, #e5e5e5);
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary, #171717);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;

  &:hover { border-color: var(--brand, #f05a22); }
  &:disabled {
    color: var(--text-muted, #737373);
    cursor: not-allowed;
    border-style: dashed;
  }
`;

const Primary = styled(Button)`
  background: var(--brand, #f05a22);
  color: white;
  border-color: var(--brand, #f05a22);

  &:hover { background: var(--brand-pressed, #f54a00); }
`;

export function RightRailConcept({ concept }: { concept: Concept }) {
  const history = useHistory();
  const { cubes } = useCatalogMeta();
  const isMeasure = concept.type === 'measure';
  const isSegment = concept.type === 'segment';

  const onExplore = () => {
    if (!isMeasure) return;
    history.push(buildConceptExploreUrl(concept.fqn, cubes));
  };

  const onActivate = () => {
    if (!isSegment) return;
    history.push(
      `/segments/new?from-concept=${encodeURIComponent(concept.fqn)}`,
    );
  };

  return (
    <Rail>
      {isMeasure ? (
        <Primary type="button" onClick={onExplore}>
          Open in Explore →
        </Primary>
      ) : (
        <Button type="button" disabled title="Open-in-Explore is measure-only">
          Open in Explore →
        </Button>
      )}
      {isSegment ? (
        <Primary type="button" onClick={onActivate}>
          Push to activation →
        </Primary>
      ) : (
        <Button
          type="button"
          disabled
          title="Push-to-activation works on segments"
        >
          Push to activation →
        </Button>
      )}
      <Button type="button" disabled title="Coming in Phase 9">
        Subscribe
      </Button>
      <Button type="button" disabled title="Coming in Phase 6">
        Edit
      </Button>
    </Rail>
  );
}
