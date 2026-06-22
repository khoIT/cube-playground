/**
 * QueryArtifactCard — displays a Cube query artifact emitted by the agent.
 *
 * On "Open in Playground" click:
 *   - if deeplinkVia === 'session-storage': write payload to sessionStorage first
 *   - then history.push(deeplinkUrl)
 *   - then call onClick?.()
 *
 * When the artifact carries an embedded chart, the header exposes a
 * view-switcher menu (chart type / data table / Export CSV) and the body
 * swaps between the embedded chart and a data table.
 */
import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { BarChart2, ExternalLink } from 'lucide-react';
import { T, Icon } from '../../../shell/theme';
import { AssistantChartSection } from './assistant-chart-section';
import { ChartSectionMenu, preferDualAxis, preferTableView } from './chart-section-menu';
import { ComparisonViewToggle, isComparisonChart, type ComparisonView } from './comparison-view-toggle';
import { QueryRefineRow } from './query-refine-row';
import { ChartSectionDataTable } from './chart-section-data-table';
import { buildLabelMap } from './chart-column-labels';
import { openArtifactInPlayground } from './open-artifact-in-playground';
import type { QueryArtifact, ChartSpec } from '../../../api/chat-sse-client';

interface QueryArtifactCardProps {
  artifact: QueryArtifact;
  onClick?: () => void;
  /** Send a refinement as a follow-up turn. When omitted, the refine row is hidden. */
  onRefine?: (text: string) => void;
}

const SOURCE_LABEL: Record<QueryArtifact['source'], string> = {
  'business-metric': 'Metric',
  segment: 'Segment',
  raw: 'Raw Query',
};

// Source-type accent, mapped to the semantic design-system palette (brand /
// info / muted) rather than raw hermes scale values — the previous blue500 /
// purple500 weren't part of the system and read as off-brand in chat.
const SOURCE_COLOR: Record<QueryArtifact['source'], string> = {
  'business-metric': 'var(--shell-brand)',
  segment: 'var(--info-ink)',
  raw: 'var(--muted-ink)',
};

export function QueryArtifactCard({ artifact, onClick, onRefine }: QueryArtifactCardProps) {
  const history = useHistory();
  // Table-first for table-shaped results (leaderboards / wide multi-column);
  // small categorical charts open on the chart.
  const [view, setView] = useState<'chart' | 'table'>(() =>
    artifact.chart && preferTableView(artifact.chart.spec) ? 'table' : 'chart',
  );
  const [overrideType, setOverrideType] = useState<ChartSpec['type'] | undefined>(undefined);
  const [overrideEncoding, setOverrideEncoding] = useState<ChartSpec['encoding'] | undefined>(undefined);
  const [comparisonView, setComparisonView] = useState<ComparisonView>('overlaid');

  function handleOpen() {
    openArtifactInPlayground(artifact, history);
    onClick?.();
  }

  const sourceColor = SOURCE_COLOR[artifact.source] ?? 'var(--shell-text-faint)';
  const sourceLabel = SOURCE_LABEL[artifact.source] ?? artifact.source;
  const chart = artifact.chart;
  // Mirror the embedded section's derived default so the menu shows the
  // type actually rendered (mixed-scale two-measure specs open dual-axis).
  const autoDualAxis =
    !overrideType && !overrideEncoding && !!chart && preferDualAxis(chart.spec);
  const activeType = overrideType ?? (autoDualAxis ? 'dual-axis' : chart?.spec.type);
  const activeEncoding = overrideEncoding ?? chart?.spec.encoding;
  const chartLabels = buildLabelMap(chart?.columns);

  // The comparison toggle appears only for ≥2-series artifacts. It drives the
  // rendered shape: grouped → grouped-bar, indexed → rebased multi-line, and
  // overlaid → whatever the type menu/auto-dual-axis picks.
  const comparisonEligible =
    !!chart && !!activeType && isComparisonChart(activeType, chart.spec.data, activeEncoding?.series);
  const indexed = comparisonEligible && comparisonView === 'indexed';
  const effectiveOverrideType =
    comparisonEligible && comparisonView === 'grouped' ? 'grouped-bar' : overrideType;

  return (
    <div
      style={{
        // The card shares the page's cream, so a hairline alone reads blurry —
        // the stronger warm border plus a soft shadow lift it off the surface.
        border: `1px solid var(--border-strong)`,
        borderRadius: 12,
        background: 'var(--surface-raised)',
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
        width: '100%',
        margin: '12px 0',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 24px',
          borderBottom: `1px solid var(--shell-bg-subtle)`,
        }}
      >
        <Icon icon={BarChart2} size={16} color={'var(--shell-brand)'} />
        <span
          style={{
            flex: 1,
            fontFamily: T.fSans,
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--shell-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {artifact.title}
        </span>
        {/* Source badge */}
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 12,
            background: `${sourceColor}18`,
            border: `1px solid ${sourceColor}40`,
            fontFamily: T.fSans,
            fontSize: 11,
            fontWeight: 500,
            color: sourceColor,
            flexShrink: 0,
          }}
        >
          {sourceLabel}
        </span>
        {comparisonEligible && view === 'chart' && (
          <ComparisonViewToggle value={comparisonView} onChange={setComparisonView} />
        )}
        {chart && activeType && (
          <ChartSectionMenu
            spec={chart.spec}
            view={view}
            activeType={activeType}
            rows={chart.spec.data}
            onShowChart={() => setView('chart')}
            onShowTable={() => setView('table')}
            onChangeType={(t) => {
              setOverrideType(t);
              setView('chart');
            }}
            columns={chart.columns}
            labels={chartLabels}
            activeEncoding={activeEncoding}
            onChangeEncoding={(enc) => {
              setOverrideEncoding(enc);
              setView('chart');
            }}
          />
        )}
      </div>

      {/* Summary */}
      {artifact.summary && (
        <div
          style={{
            padding: '12px 24px',
            fontFamily: T.fSans,
            fontSize: 13,
            color: 'var(--shell-text-muted)',
            lineHeight: 1.5,
          }}
        >
          {artifact.summary}
        </div>
      )}

      {/* Body — chart or data-table, with symmetric horizontal padding. */}
      {chart && (
        <div style={{ padding: '4px 24px 12px' }}>
          {view === 'chart' ? (
            <AssistantChartSection
              artifact={chart}
              embedded
              overrideType={effectiveOverrideType}
              overrideEncoding={overrideEncoding}
              indexed={indexed}
            />
          ) : (
            <ChartSectionDataTable rows={chart.spec.data} spec={chart.spec} labels={chartLabels} />
          )}
        </div>
      )}

      {/* Refine row — context-aware chips + free-text, sent as a follow-up turn. */}
      {onRefine && (
        <div style={{ padding: '4px 24px 12px' }}>
          <QueryRefineRow query={artifact.query} onRefine={onRefine} />
        </div>
      )}

      {/* Footer action */}
      <div
        style={{
          padding: '12px 24px',
          display: 'flex',
          justifyContent: 'flex-end',
          borderTop: artifact.summary || chart ? `1px solid var(--shell-bg-subtle)` : undefined,
        }}
      >
        <button
          type="button"
          onClick={handleOpen}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            // Secondary action: the answer + chart are the focus, so this reads
            // as a quiet ghost link (transparent fill, hairline border) rather
            // than a solid brand CTA competing with the data.
            height: 34,
            padding: '0 14px',
            borderRadius: 'var(--radius-md)',
            background: 'transparent',
            border: '1px solid var(--shell-border-strong)',
            cursor: 'pointer',
            fontFamily: T.fSans,
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--shell-text-muted)',
          }}
        >
          <Icon icon={ExternalLink} size={14} color={'var(--shell-text-muted)'} />
          Open in Playground
        </button>
      </div>
    </div>
  );
}
