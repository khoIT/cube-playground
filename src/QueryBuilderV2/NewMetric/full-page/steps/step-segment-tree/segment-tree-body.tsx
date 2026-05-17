import styled from 'styled-components';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import type { FilterGroup } from '../../../filter-tree';
import { FiltersBody } from '../step-4-filters/filters-body';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
`;
const Header = styled.div`
  font-size: 13.5px;
  color: var(--text-secondary);
  line-height: 1.5;
`;

export type SegmentTreeBodyProps = {
  cube: WizardCube | null;
  tree: FilterGroup;
  onChange: (next: FilterGroup) => void;
};

/**
 * Segment authoring middle step. Reuses the measure-mode filter tree component
 * verbatim — segment SQL = flattened filter tree. The reducer wipes this tree
 * when the user leaves segment mode (see `applySetArtifactKind`), so authoring
 * a segment never bleeds into a measure's filter set.
 */
export function SegmentTreeBody({ cube, tree, onChange }: SegmentTreeBodyProps) {
  return (
    <Wrap>
      <Header>
        Define the cohort. These conditions become the segment's
        <code> WHERE</code> clause when measures are queried with
        <code> segments: [&lt;qualified&gt;]</code>.
      </Header>
      <FiltersBody cube={cube} tree={tree} onChange={onChange} />
    </Wrap>
  );
}
