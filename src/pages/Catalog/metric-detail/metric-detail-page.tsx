/**
 * MetricDetailPage — `/catalog/metric/:id`. Resolves the business metric from
 * `useBusinessMetrics()`, renders header + 5-tab shell + right rail. Unknown
 * id renders a friendly 404 with "Did you mean…" fuzzy suggestions from the
 * registry (matched against id, label, and synonyms).
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import styled from 'styled-components';

import { ChangeAnalysisModal } from '../../../shared/concept-shell/change-analysis-modal';
import { useTopbarBreadcrumbOverride } from '../../../shell/topbar/topbar-breadcrumb-context';
import type { BusinessMetric } from '../metrics-tab/business-metric-types';
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

const Suggestions = styled.ul`
  list-style: none;
  padding: 0;
  margin: 14px auto 18px;
  display: inline-flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;

  li code {
    color: var(--text-secondary, #525252);
    font-size: 12px;
  }
`;

// Suggest up to 5 plausible matches when an id is not found. Scoring favours
// prefix matches (e.g. "ltv" → "ltv_30", "ltv") over substring matches so the
// most natural completions surface first.
function suggestSimilar(id: string, metrics: BusinessMetric[]): BusinessMetric[] {
  const q = id.toLowerCase();
  const scored = metrics
    .map((m) => {
      const haystacks = [m.id, m.label.toLowerCase(), ...(m.synonyms ?? [])];
      let score = 0;
      for (const h of haystacks) {
        if (h === q) score = Math.max(score, 100);
        else if (h.startsWith(q) || q.startsWith(h)) score = Math.max(score, 60);
        else if (h.includes(q) || q.includes(h)) score = Math.max(score, 30);
      }
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return scored.map((x) => x.m);
}

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
    const suggestions = id ? suggestSimilar(id, metrics) : [];
    return (
      <Status>
        <p>No metric named <code>{id}</code> found in the registry.</p>
        {suggestions.length > 0 && (
          <>
            <p>Did you mean…?</p>
            <Suggestions>
              {suggestions.map((s) => (
                <li key={s.id}>
                  <Link to={`/catalog/metric/${s.id}`}>
                    {s.label} <code>({s.id})</code>
                  </Link>
                </li>
              ))}
            </Suggestions>
          </>
        )}
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
