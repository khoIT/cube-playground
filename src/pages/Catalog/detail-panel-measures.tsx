/**
 * DetailPanelMeasures — measures section of `<DetailPanel>`, extracted to
 * keep the parent under the 200-line ceiling. Owns expanded-row state and
 * wires `<MeasureRow>` ↔ `<CdpProjectionCard>` per cube.
 */

import { useEffect, useState } from 'react';
import styled from 'styled-components';
import type { CatalogCube } from './use-catalog-meta';
import { MeasureRow } from './measure-row';
import { CdpProjectionCard } from './cdp-projection/cdp-projection-card';
import { projectMeasure } from './cdp-projection/project-measure';
import type { ProjectableCube, ProjectableMeasure } from './cdp-projection/types';

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
  const [expandedMeasureName, setExpandedMeasureName] = useState<string | null>(null);
  const cubeHasCdpMapping = Boolean(cube.meta?.cdp_source);

  useEffect(() => {
    setExpandedMeasureName(null);
  }, [cube.name]);

  return (
    <Section>
      <SectionTitle>Measures ({cube.measures.length})</SectionTitle>
      {cube.measures.map((m) => {
        const projection = projectMeasure(
          cube as unknown as ProjectableCube,
          m as unknown as ProjectableMeasure,
        );
        const rowExpandable = cubeHasCdpMapping && projection.ok;
        return (
          <MeasureRow
            key={m.name}
            measure={m}
            cube={cube}
            expandable={rowExpandable}
            expanded={expandedMeasureName === m.name}
            onToggle={() =>
              setExpandedMeasureName((prev) => (prev === m.name ? null : m.name))
            }
          >
            {rowExpandable && <CdpProjectionCard projection={projection} />}
          </MeasureRow>
        );
      })}
    </Section>
  );
}
