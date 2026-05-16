import styled from 'styled-components';
import { CatalogCube } from './use-catalog-meta';
import { CubeClusters } from './use-cube-clusters';
import { CubeCard } from './cube-card';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding-top: 12px;
`;

const Group = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const GroupHeading = styled.h2`
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
`;

interface CatalogGridProps {
  clusters: CubeClusters;
  onSelect: (cubeName: string) => void;
  selected: string | null;
}

export function CatalogGrid({ clusters, onSelect, selected }: CatalogGridProps) {
  return (
    <Wrap>
      {clusters.connected.map((group, idx) => (
        <Group key={`cc-${idx}`}>
          <GroupHeading>Connected — {group.length} cubes</GroupHeading>
          <Grid>
            {group.map((c) => (
              <CubeCard
                key={c.name}
                cube={c}
                selected={selected === c.name}
                onClick={() => onSelect(c.name)}
              />
            ))}
          </Grid>
        </Group>
      ))}

      {clusters.standalone.length > 0 && (
        <Group>
          <GroupHeading>Standalone — {clusters.standalone.length}</GroupHeading>
          <Grid>
            {clusters.standalone.map((c) => (
              <CubeCard
                key={c.name}
                cube={c}
                selected={selected === c.name}
                onClick={() => onSelect(c.name)}
              />
            ))}
          </Grid>
        </Group>
      )}
    </Wrap>
  );
}
