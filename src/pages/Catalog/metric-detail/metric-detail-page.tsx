/**
 * MetricDetailPage — `/catalog/metric/:id`. Resolves the business metric from
 * `useBusinessMetrics()`, renders header + 5-tab shell + right rail. Unknown
 * id renders a friendly 404 with a back-to-Catalog link.
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import styled from 'styled-components';

import { ChangeAnalysisModal } from '../../../shared/concept-shell/change-analysis-modal';
import { useTopbarBreadcrumbOverride } from '../../../shell/topbar/topbar-breadcrumb-context';
import { useBusinessMetrics } from '../metrics-tab/use-business-metrics';
import { MetricDetailHeader } from './metric-detail-header';
import {
  MetricDetailTabs,
  type DetailTabKey,
} from './metric-detail-tabs';
import { RightRail } from './right-rail';
import { TabActivity } from './tab-activity';
import { TabFormula } from './tab-formula';
import { TabLineage } from './tab-lineage';
import { TabOverview } from './tab-overview';
import { TabSlices } from './tab-slices';

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

export function MetricDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { metrics, loading, error } = useBusinessMetrics();
  const [active, setActive] = useState<DetailTabKey>('overview');
  const [anomalyOpen, setAnomalyOpen] = useState(false);

  const metric = metrics.find((m) => m.id === id) ?? null;
  // Swap the topbar breadcrumb tail (metric id → human label) once resolved.
  useTopbarBreadcrumbOverride(metric?.label ?? null, [metric?.id, metric?.label]);

  if (loading) return <Status>Loading metric…</Status>;
  if (error) return <Status>Failed to load registry: {error}</Status>;

  if (!metric) {
    return (
      <Status>
        <p>No metric named <code>{id}</code> found in the registry.</p>
        <Link to="/catalog">← Back to Catalog</Link>
      </Status>
    );
  }

  return (
    <Page>
      <MetricDetailHeader metric={metric} onAnomalyClick={() => setAnomalyOpen(true)} />
      <MetricDetailTabs active={active} onChange={setActive} />
      <Body>
        <Main>
          {active === 'overview' && <TabOverview metric={metric} />}
          {active === 'formula' && <TabFormula metric={metric} />}
          {active === 'lineage' && <TabLineage metric={metric} allMetrics={metrics} />}
          {active === 'slices' && <TabSlices metric={metric} />}
          {active === 'activity' && <TabActivity />}
        </Main>
        <RightRail metric={metric} />
      </Body>
      <ChangeAnalysisModal
        open={anomalyOpen}
        metric={metric}
        onClose={() => setAnomalyOpen(false)}
      />
    </Page>
  );
}
