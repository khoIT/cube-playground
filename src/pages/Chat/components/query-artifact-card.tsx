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
import { ChartSectionMenu, preferTableView } from './chart-section-menu';
import { ChartSectionDataTable } from './chart-section-data-table';
import { buildLabelMap } from './chart-column-labels';
import type { QueryArtifact, ChartSpec } from '../../../api/chat-sse-client';

interface QueryArtifactCardProps {
  artifact: QueryArtifact;
  onClick?: () => void;
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
  'business-metric': T.brand,
  segment: 'var(--info-ink)',
  raw: 'var(--muted-ink)',
};

export function QueryArtifactCard({ artifact, onClick }: QueryArtifactCardProps) {
  const history = useHistory();
  // Table-first for table-shaped results (leaderboards / wide multi-column);
  // small categorical charts open on the chart.
  const [view, setView] = useState<'chart' | 'table'>(() =>
    artifact.chart && preferTableView(artifact.chart.spec) ? 'table' : 'chart',
  );
  const [overrideType, setOverrideType] = useState<ChartSpec['type'] | undefined>(undefined);
  const [overrideEncoding, setOverrideEncoding] = useState<ChartSpec['encoding'] | undefined>(undefined);

  function handleOpen() {
    // Write payload to sessionStorage BEFORE navigation for session-storage artifacts.
    if (artifact.deeplinkVia === 'session-storage') {
      try {
        sessionStorage.setItem(
          `gds-cube:pending-chat-deeplink:${artifact.id}`,
          JSON.stringify(artifact.payload),
        );
      } catch {
        // sessionStorage quota/unavailable — proceed anyway; /build will show stale toast.
      }
    }
    // Push deeplinkUrl (hash-based) into React Router history.
    // deeplinkUrl is "#/build?..." — strip the leading '#' for react-router-dom v5.
    const path = artifact.deeplinkUrl.startsWith('#')
      ? artifact.deeplinkUrl.slice(1)
      : artifact.deeplinkUrl;
    history.push(path);
    onClick?.();
  }

  const sourceColor = SOURCE_COLOR[artifact.source] ?? T.n400;
  const sourceLabel = SOURCE_LABEL[artifact.source] ?? artifact.source;
  const chart = artifact.chart;
  const activeType = overrideType ?? chart?.spec.type;
  const activeEncoding = overrideEncoding ?? chart?.spec.encoding;
  const chartLabels = buildLabelMap(chart?.columns);

  return (
    <div
      style={{
        border: `1px solid ${T.n200}`,
        borderRadius: 12,
        background: T.surface,
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
          borderBottom: `1px solid ${T.n100}`,
        }}
      >
        <Icon icon={BarChart2} size={16} color={T.brand} />
        <span
          style={{
            flex: 1,
            fontFamily: T.fSans,
            fontSize: 14,
            fontWeight: 600,
            color: T.n900,
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
            color: T.n600,
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
              overrideType={overrideType}
              overrideEncoding={overrideEncoding}
            />
          ) : (
            <ChartSectionDataTable rows={chart.spec.data} spec={chart.spec} labels={chartLabels} />
          )}
        </div>
      )}

      {/* Footer action */}
      <div
        style={{
          padding: '12px 24px',
          display: 'flex',
          justifyContent: 'flex-end',
          borderTop: artifact.summary || chart ? `1px solid ${T.n100}` : undefined,
        }}
      >
        <button
          type="button"
          onClick={handleOpen}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '6px 14px',
            borderRadius: 6,
            background: T.brand,
            border: 'none',
            cursor: 'pointer',
            fontFamily: T.fSans,
            fontSize: 12,
            fontWeight: 500,
            color: '#fff',
          }}
        >
          <Icon icon={ExternalLink} size={13} color="#fff" />
          Open in Playground
        </button>
      </div>
    </div>
  );
}
