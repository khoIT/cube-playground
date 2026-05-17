/**
 * DetailPanelMeasures — measures section of `<DetailPanel>`. Each row is a
 * clickable navigation target that pushes the user to the per-measure card at
 * `/metric/:cube/:member`. The previous inline CDP-projection accordion was
 * removed; CDP projection now renders inside the MetricCard instead.
 */

import styled from 'styled-components';
import { useHistory } from 'react-router-dom';
import type { CatalogCube } from './use-catalog-meta';
import { MeasureRow } from './measure-row';
import { buildMetricUrl } from './try-it-url';

const Section = styled.section`
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-card);
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SectionTitle = styled.h3`
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

interface DetailPanelMeasuresProps {
  cube: CatalogCube;
}

export function DetailPanelMeasures({ cube }: DetailPanelMeasuresProps) {
  const history = useHistory();

  return (
    <Section>
      <SectionTitle>Measures ({cube.measures.length})</SectionTitle>
      {cube.measures.map((m) => (
        <MeasureRow
          key={m.name}
          measure={m}
          cube={cube}
          onClick={() => history.push(buildMetricUrl(m.name))}
        />
      ))}
    </Section>
  );
}
