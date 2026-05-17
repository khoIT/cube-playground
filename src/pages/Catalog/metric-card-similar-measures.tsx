/**
 * MetricCardSimilarMeasures — lists aggType peers on the same source cube,
 * each as a Link to its `/metric/:cube/:member` page. Sort: measures with a
 * description come first (more useful), then alphabetical. Capped at 5 to
 * avoid drowning the card in similar entries.
 */

import { Link } from 'react-router-dom';
import styled from 'styled-components';
import type { CatalogCube, CatalogMeasure } from './use-catalog-meta';
import { Section, SectionTitle, Row, Code, Chip } from './metric-card-styles';
import { buildMetricUrl } from './try-it-url';

const MAX_PEERS = 5;

const PeerLink = styled(Link)`
  text-decoration: none;
  color: inherit;
  &:hover code {
    color: var(--brand);
  }
`;

function rankPeers(peers: CatalogMeasure[]): CatalogMeasure[] {
  return peers.slice().sort((a, b) => {
    const da = a.description ? 0 : 1;
    const db = b.description ? 0 : 1;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });
}

function shortName(qualified: string): string {
  const dot = qualified.indexOf('.');
  return dot >= 0 ? qualified.slice(dot + 1) : qualified;
}

interface Props {
  cube: CatalogCube;
  measure: CatalogMeasure;
}

export function MetricCardSimilarMeasures({ cube, measure }: Props) {
  if (!measure.aggType) return null;
  const peers = cube.measures.filter(
    (m) => m.aggType === measure.aggType && m.name !== measure.name,
  );
  if (peers.length === 0) return null;

  const ranked = rankPeers(peers).slice(0, MAX_PEERS);

  return (
    <Section>
      <SectionTitle>Similar measures ({peers.length})</SectionTitle>
      {ranked.map((p) => (
        <PeerLink key={p.name} to={buildMetricUrl(p.name)}>
          <Row>
            <span>
              <Code>{shortName(p.name)}</Code>
              {p.aggType && <Chip>{p.aggType}</Chip>}
            </span>
          </Row>
        </PeerLink>
      ))}
    </Section>
  );
}
