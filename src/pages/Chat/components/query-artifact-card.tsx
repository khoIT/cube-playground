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
import React, { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { BarChart2, ExternalLink, Users, SlidersHorizontal } from 'lucide-react';
import { T, Icon } from '../../../shell/theme';
import { AssistantChartSection } from './assistant-chart-section';
import { ChartSectionMenu, preferDualAxis, preferTableView } from './chart-section-menu';
import { ComparisonViewToggle, isComparisonChart, type ComparisonView } from './comparison-view-toggle';
import { QueryRefineRow } from './query-refine-row';
import { ChartSectionDataTable } from './chart-section-data-table';
import { getArtifactViewState, rememberArtifactViewState } from './artifact-view-state';
import { buildLabelMap } from './chart-column-labels';
import { openArtifactInPlayground } from './open-artifact-in-playground';
import { useBuildSegmentFromQuery } from './use-build-segment-from-query';
import { SegmentProposalCard } from './segment-proposal-card';
import { SegmentSeedValuePicker } from './segment-seed-value-picker';
import type { QueryArtifact, ChartSpec } from '../../../api/chat-sse-client';
import styles from './query-artifact-card.module.css';

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
  // A prior toggle on this artifact (this surface or the side panel) wins over
  // the data-shape default, so the user's chart/table choice follows it across
  // surfaces. Falls back to table-first for table-shaped results (leaderboards
  // / wide multi-column); small categorical and trend charts open on the chart.
  const saved = getArtifactViewState(artifact.id);
  const [view, setView] = useState<'chart' | 'table'>(
    () => saved?.view ?? (artifact.chart && preferTableView(artifact.chart.spec) ? 'table' : 'chart'),
  );
  const [overrideType, setOverrideType] = useState<ChartSpec['type'] | undefined>(saved?.overrideType);
  const [overrideEncoding, setOverrideEncoding] = useState<ChartSpec['encoding'] | undefined>(
    saved?.overrideEncoding,
  );
  const [comparisonView, setComparisonView] = useState<ComparisonView>(saved?.comparisonView ?? 'overlaid');

  // Mirror every view change into the shared cache so the other surface reads
  // the same state when it next mounts this artifact.
  useEffect(() => {
    rememberArtifactViewState(artifact.id, { view, overrideType, overrideEncoding, comparisonView });
  }, [artifact.id, view, overrideType, overrideEncoding, comparisonView]);

  // "Build segment from this" bridge — eager segmentability probe gates the
  // button; clicking lands a pre-filled SegmentProposalCard inline (below).
  // `seed` is set for breakdown queries: the button opens a value picker first.
  const { segmentable, seed, proposal, build, buildFromSeed } = useBuildSegmentFromQuery(artifact);
  const [seedOpen, setSeedOpen] = useState(false);
  // Refine is now part of the unified action bar; the card owns its open state
  // so the collapsed toggle can sit inline with Build / Open in Playground.
  const [refineOpen, setRefineOpen] = useState(false);

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
    <>
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

      {/* Refine panel — full-width when expanded; the toggle lives in the bar below. */}
      {onRefine && refineOpen && (
        <div style={{ padding: '0 24px 12px' }}>
          <QueryRefineRow
            query={artifact.query}
            onRefine={onRefine}
            expanded
            onCollapse={() => setRefineOpen(false)}
          />
        </div>
      )}

      {/* Unified action bar: Refine (tertiary) left; Build (primary) + Open (secondary) right. */}
      <div
        className={styles.actionBar}
        style={{ borderTop: artifact.summary || chart ? `1px solid var(--shell-bg-subtle)` : undefined }}
      >
        <div className={styles.actionLeft}>
          {onRefine && !refineOpen && (
            <button
              type="button"
              className={`${styles.btn} ${styles.ghostBtn}`}
              onClick={() => setRefineOpen(true)}
              aria-expanded={false}
            >
              <Icon icon={SlidersHorizontal} size={14} />
              Refine query
            </button>
          )}
        </div>
        <div className={styles.actionRight}>
          {/* Build-segment bridge — direct (segmentable) or seed (breakdown) path,
              pre-proposal and before the seed picker opens. */}
          {(segmentable || seed) && !proposal && !seedOpen && (
            <button
              type="button"
              className={`${styles.btn} ${styles.primaryBtn}`}
              onClick={seed && !segmentable ? () => setSeedOpen(true) : build}
            >
              <Icon icon={Users} size={14} />
              Build segment from this
            </button>
          )}
          <button type="button" className={`${styles.btn} ${styles.secondaryBtn}`} onClick={handleOpen}>
            <Icon icon={ExternalLink} size={14} />
            Open in Playground
          </button>
        </div>
      </div>
    </div>
    {/* Seed picker: a breakdown query asks which dimension value(s) to filter on
        before it can become a cohort. Confirming hands back an equals/in predicate. */}
    {seed && seedOpen && !proposal && artifact.game && (
      <SegmentSeedValuePicker
        gameId={artifact.game}
        dimensions={seed.dimensions}
        query={artifact.query}
        onConfirm={(dimension, values) => {
          buildFromSeed(dimension, values);
          setSeedOpen(false);
        }}
        onCancel={() => setSeedOpen(false)}
      />
    )}
    {/* Inline proposal: one click from an explored result to a pre-filled cohort. */}
    {proposal && <SegmentProposalCard proposal={proposal} />}
    </>
  );
}
