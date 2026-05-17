import styled from 'styled-components';
import { Sigma, Tags, Filter } from 'lucide-react';
import type { ArtifactKind } from '../../../types';
import { ArtifactKindCard } from './artifact-kind-card';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 880px;
`;

const Intro = styled.div`
  font-size: 13.5px;
  color: var(--text-secondary);
  line-height: 1.5;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;

  @media (max-width: 880px) {
    grid-template-columns: 1fr;
  }
`;

type KindCopy = {
  kind: ArtifactKind;
  title: string;
  tagline: string;
  example: string;
};

const KIND_COPY: KindCopy[] = [
  {
    kind: 'measure',
    title: 'Measure',
    tagline: "How much / how many / what's the avg — one number out.",
    example: 'sum(revenue), count_distinct(user_id)',
  },
  {
    kind: 'dimension',
    title: 'Dimension',
    tagline: 'A property of each row — used in WHERE / GROUP BY.',
    example: 'ltv_tier, days_since_install, country',
  },
  {
    kind: 'segment',
    title: 'Segment',
    tagline: 'A reusable named WHERE clause — name a cohort once, reuse everywhere.',
    example: "country = 'VN' AND ltv_vnd >= 10_000_000",
  },
];

const ICONS: Record<ArtifactKind, JSX.Element> = {
  measure: <Sigma size={18} />,
  dimension: <Tags size={18} />,
  segment: <Filter size={18} />,
};

export type ArtifactKindBodyProps = {
  selected: ArtifactKind;
  /** Called when a kind card is clicked. Parent handles confirm dialog when
   *  switching away would clobber kind-specific sub-state. */
  onSelect: (kind: ArtifactKind) => void;
  /** True while a confirm dialog is open; disables all cards to prevent a
   *  double-fire (red-team F-W). */
  disabled?: boolean;
};

export function ArtifactKindBody({ selected, onSelect, disabled = false }: ArtifactKindBodyProps) {
  return (
    <Wrap role="radiogroup" aria-label="Artifact kind">
      <Intro>
        Pick what you're authoring. Measures emit a number; dimensions categorize
        rows; segments name a reusable cohort. You can switch later, but kind-specific
        choices will reset.
      </Intro>
      <Grid>
        {KIND_COPY.map((c) => (
          <ArtifactKindCard
            key={c.kind}
            selected={selected === c.kind}
            disabled={disabled}
            icon={ICONS[c.kind]}
            title={c.title}
            tagline={c.tagline}
            example={c.example}
            onSelect={() => onSelect(c.kind)}
          />
        ))}
      </Grid>
    </Wrap>
  );
}
