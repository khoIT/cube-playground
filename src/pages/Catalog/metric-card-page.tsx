/**
 * MetricCardPage — route entry for `/metric/:cube/:member`.
 *
 * Resolves URL params against `useCatalogMeta()` cubes, then renders
 * `<MetricCard>` on the happy path. Owns the meta fetch + URL parsing so the
 * MetricCard component itself stays pure and reusable from other surfaces.
 */

import { useParams, Link } from 'react-router-dom';
import styled from 'styled-components';
import { useCatalogMeta } from './use-catalog-meta';
import { MetricCard } from './metric-card';

const Panel = styled.section`
  max-width: 640px;
  margin: 48px auto;
  padding: 24px 28px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const PanelTitle = styled.h2`
  margin: 0;
  font-size: 16px;
  color: var(--text-primary);
`;

const PanelBody = styled.p`
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
`;

const BackLink = styled(Link)`
  color: var(--brand);
  font-size: 13px;
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
`;

interface RouteParams {
  cube: string;
  member: string;
}

export function MetricCardPage() {
  const params = useParams<RouteParams>();
  const cubeName = decodeURIComponent(params.cube ?? '');
  const memberName = decodeURIComponent(params.member ?? '');
  const fqn = `${cubeName}.${memberName}`;

  const { cubes, loading, error } = useCatalogMeta();

  if (loading) {
    return (
      <Panel>
        <PanelTitle>Loading…</PanelTitle>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel>
        <PanelTitle>Couldn’t load schema</PanelTitle>
        <PanelBody>{error}</PanelBody>
        <BackLink to="/catalog">← Back to Catalog</BackLink>
      </Panel>
    );
  }

  const cube = cubes.find((c) => c.name === cubeName);
  if (!cube) {
    return (
      <Panel>
        <PanelTitle>Cube not found</PanelTitle>
        <PanelBody>
          No cube named <code>{cubeName}</code> is exposed by this Cube
          deployment.
        </PanelBody>
        <BackLink to="/catalog">← Back to Catalog</BackLink>
      </Panel>
    );
  }

  const measure = cube.measures.find((m) => m.name === fqn);
  if (!measure) {
    return (
      <Panel>
        <PanelTitle>Measure not in cube</PanelTitle>
        <PanelBody>
          <code>{fqn}</code> doesn’t exist on cube <code>{cube.name}</code>.
        </PanelBody>
        <BackLink to="/catalog">← Back to Catalog</BackLink>
      </Panel>
    );
  }

  return <MetricCard cube={cube} measure={measure} allCubes={cubes} />;
}
