import styled from 'styled-components';
import { Layers, Clock, ArrowRight, ToggleRight } from 'lucide-react';
import type { DimKind } from '../../../types';
import { DimKindCard } from './dim-kind-card';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 880px;
`;

const Intro = styled.div`
  font-size: 13.5px;
  color: var(--text-secondary);
  line-height: 1.5;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

type DimKindCopy = {
  kind: DimKind;
  title: string;
  tagline: string;
  example: string;
};

const COPY: DimKindCopy[] = [
  {
    kind: 'banding',
    title: 'Banding',
    tagline: 'Bucket a numeric column into labelled bands.',
    example: 'ltv_vnd → whale / dolphin / minnow',
  },
  {
    kind: 'time-since',
    title: 'Time since',
    tagline: 'Days/hours/months since a timestamp column.',
    example: 'install_date → days_since_install',
  },
  {
    kind: 'passthrough',
    title: 'Passthrough',
    tagline: 'Expose a raw column as a dimension as-is.',
    example: 'country, language, device',
  },
  {
    kind: 'boolean',
    title: 'Boolean',
    tagline: 'Yes/no flag from a single predicate.',
    example: 'is_paying = ltv_vnd > 0',
  },
];

const ICONS: Record<DimKind, JSX.Element> = {
  banding: <Layers size={15} />,
  'time-since': <Clock size={15} />,
  passthrough: <ArrowRight size={15} />,
  boolean: <ToggleRight size={15} />,
};

export type DimKindBodyProps = {
  selected: DimKind | undefined;
  onSelect: (kind: DimKind) => void;
};

export function DimKindBody({ selected, onSelect }: DimKindBodyProps) {
  return (
    <Wrap role="radiogroup" aria-label="Dimension kind">
      <Intro>
        Pick how this dimension is derived. Each kind emits a different SQL template
        in the YAML — banding writes a <code>case</code> block, time-since wraps a
        <code> DATE_DIFF</code>, passthrough exposes the column raw, and boolean wraps a
        single predicate in <code>CASE WHEN … THEN TRUE ELSE FALSE</code>.
      </Intro>
      <Grid>
        {COPY.map((c) => (
          <DimKindCard
            key={c.kind}
            selected={selected === c.kind}
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
