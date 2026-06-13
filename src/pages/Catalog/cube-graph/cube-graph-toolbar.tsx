/**
 * CubeGraphToolbar — search, view-highlight select, and the lint summary chip
 * above the join-graph canvas. Mirrors CatalogToolbar's bar styling so the
 * Graph and Grid views of the Cubes surface read as one page.
 */
import styled from 'styled-components';

import { CubeGraphLegend } from './cube-graph-legend';
import { CardinalityKey } from './edge-cardinality-markers';

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 24px 8px;
  flex-wrap: wrap;
`;

const MetaRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 24px 10px;
  flex-wrap: wrap;
`;

const Stats = styled.span`
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-sans);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
`;

const Divider = styled.span`
  width: 1px;
  height: 14px;
  background: var(--border-card);
  flex-shrink: 0;
`;

const Hint = styled.span`
  font-size: 11px;
  font-family: var(--font-sans);
  color: var(--text-muted);
`;

const LegendSlot = styled.div`
  margin-left: auto;
`;

const SearchBox = styled.input`
  flex: 1;
  max-width: 360px;
  padding: 8px 12px;
  font-size: 13px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-input);
  background: var(--bg-card);
  color: var(--text-primary);
  outline: 0;

  &:focus {
    border-color: var(--brand);
  }
`;

const ViewSelect = styled.select`
  padding: 7px 10px;
  font-size: 12px;
  font-family: var(--font-sans);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-input);
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
`;

const LintChip = styled.button`
  appearance: none;
  cursor: pointer;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-sans);
  border-radius: var(--radius-pill);
  border: 1px solid var(--warning-ink);
  background: var(--warning-soft);
  color: var(--warning-ink);
`;

interface Props {
  search: string;
  onSearchChange: (next: string) => void;
  /** View names available for highlight (empty hides the select). */
  views: string[];
  selectedView: string | null;
  onViewChange: (view: string | null) => void;
  isolatedCount: number;
  missingTargetCount: number;
  /** Cycle selection through lint-flagged cubes. */
  onLintCycle: () => void;
  /** Stats line + legend. */
  cubeCount: number;
  joinCount: number;
  viewCount: number;
  presentClusters: ReadonlySet<string>;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function CubeGraphToolbar({
  search,
  onSearchChange,
  views,
  selectedView,
  onViewChange,
  isolatedCount,
  missingTargetCount,
  onLintCycle,
  cubeCount,
  joinCount,
  viewCount,
  presentClusters,
}: Props) {
  const lintParts = [
    isolatedCount > 0 ? `${isolatedCount} isolated` : null,
    missingTargetCount > 0 ? `${missingTargetCount} missing target` : null,
  ].filter(Boolean);

  return (
    <>
      <Bar>
        <SearchBox
          type="search"
          placeholder="Search cubes…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search cube graph"
        />
        {views.length > 0 && (
          <ViewSelect
            value={selectedView ?? ''}
            onChange={(e) => onViewChange(e.target.value || null)}
            aria-label="Highlight cubes composing a view"
          >
            <option value="">Highlight view…</option>
            {views.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </ViewSelect>
        )}
        {lintParts.length > 0 && (
          <LintChip type="button" onClick={onLintCycle} title="Click to cycle through flagged cubes">
            {lintParts.join(' · ')}
          </LintChip>
        )}
      </Bar>
      <MetaRow>
        <Stats>
          {[plural(cubeCount, 'cube'), plural(joinCount, 'join'), plural(viewCount, 'view')].join(
            ' · ',
          )}
        </Stats>
        <Divider />
        <Hint>click to focus · drag to rearrange</Hint>
        <Divider />
        <CardinalityKey />
        <LegendSlot>
          <CubeGraphLegend present={presentClusters} />
        </LegendSlot>
      </MetaRow>
    </>
  );
}
