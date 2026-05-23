/**
 * ConceptDetailPage — route `/catalog/concept/:type/:fqn`. Resolves a Concept
 * from the active game's /meta, then renders the shared 5-tab shell with
 * type-aware bodies. FQN is URL-encoded.
 */

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import styled from 'styled-components';

import { useTopbarBreadcrumbOverride } from '../../../shell/topbar/topbar-breadcrumb-context';
import {
  MetricDetailTabs,
  type DetailTabKey,
} from '../metric-detail/metric-detail-tabs';
import { TabActivity } from '../metric-detail/tab-activity';
import { useBusinessMetrics } from '../metrics-tab/use-business-metrics';
import { useConcepts } from '../data-model-tab/use-concepts';
import { ConceptDetailHeader } from './concept-detail-header';
import { RightRailConcept } from './right-rail-concept';
import { TabFormulaConcept } from './tab-formula-concept';
import { TabLineageConcept } from './tab-lineage-concept';
import { TabOverviewConcept } from './tab-overview-concept';
import { TabSlicesConcept } from './tab-slices-concept';
import type { ConceptType } from '../data-model-tab/concept-types';

const Page = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-app);
`;

const Body = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
`;

const Main = styled.div`
  flex: 1;
  overflow-y: auto;
`;

const Status = styled.div`
  padding: 60px 24px;
  text-align: center;
  color: var(--text-muted, #737373);
  font-size: 14px;

  a {
    color: var(--brand, #f05a22);
    text-decoration: none;
  }
  a:hover { text-decoration: underline; }
`;

const VALID_TYPES: ConceptType[] = ['measure', 'dimension', 'segment'];

// Historic links from before the conceptsFromCube fix produced fqns with the
// cube name appearing twice (`mf_users.mf_users.dau`). Normalise so old
// bookmarks / cached search results still resolve.
function normaliseFqn(raw: string): string {
  const parts = raw.split('.');
  if (parts.length >= 3 && parts[0] === parts[1]) {
    return parts.slice(1).join('.');
  }
  return raw;
}

export function ConceptDetailPage() {
  const { type, fqn } = useParams<{ type: string; fqn: string }>();
  const decodedFqn = useMemo(
    () => normaliseFqn(decodeURIComponent(fqn ?? '')),
    [fqn],
  );
  const { concepts, cubes, loading, error } = useConcepts();
  const { metrics: businessMetrics } = useBusinessMetrics();
  const [active, setActive] = useState<DetailTabKey>('overview');

  const cubesByName = useMemo(() => {
    const out = new Map<string, (typeof cubes)[number]>();
    for (const c of cubes) out.set(c.name, c);
    return out;
  }, [cubes]);

  const concept = useMemo(
    () =>
      concepts.find(
        (c) => c.type === (type as ConceptType) && c.fqn === decodedFqn,
      ) ?? null,
    [concepts, type, decodedFqn],
  );
  // Swap the topbar breadcrumb tail (URL-encoded fqn → readable name).
  useTopbarBreadcrumbOverride(concept?.fqn ?? null, [concept?.fqn]);

  if (loading) return <Status>Loading concept…</Status>;
  if (error) return <Status>Failed to load /meta: {error}</Status>;

  if (!VALID_TYPES.includes(type as ConceptType)) {
    return (
      <Status>
        <p>Unknown concept type <code>{type}</code>.</p>
        <Link to="/catalog/data-model">← Back to Data Model</Link>
      </Status>
    );
  }

  if (!concept) {
    return (
      <Status>
        <p>
          No {type} <code>{decodedFqn}</code> in the active game's /meta.
        </p>
        <Link to="/catalog/data-model">← Back to Data Model</Link>
      </Status>
    );
  }

  const cube = cubesByName.get(concept.cube) ?? null;

  return (
    <Page>
      <ConceptDetailHeader concept={concept} />
      <MetricDetailTabs active={active} onChange={setActive} />
      <Body>
        <Main>
          {active === 'overview' && <TabOverviewConcept concept={concept} />}
          {active === 'formula' && <TabFormulaConcept concept={concept} />}
          {active === 'lineage' && (
            <TabLineageConcept
              concept={concept}
              businessMetrics={businessMetrics}
            />
          )}
          {active === 'slices' && (
            <TabSlicesConcept
              concept={concept}
              cube={cube}
              cubesByName={cubesByName}
            />
          )}
          {active === 'activity' && <TabActivity />}
        </Main>
        <RightRailConcept concept={concept} />
      </Body>
    </Page>
  );
}
