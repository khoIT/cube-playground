/**
 * AssistantChartSection — renders a ChartArtifact with recharts.
 *
 * Non-embedded mode spans the full container width with symmetric inner
 * padding and a header row exposing a view-switcher menu (chart type,
 * data table, CSV export). Embedded mode (inside QueryArtifactCard) stays
 * minimal: just the chart body, no header, no menu.
 */
import React, { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  FunnelChart,
  Funnel,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { T, CHART } from '../../../shell/theme';
import { ChartSectionMenu } from './chart-section-menu';
import { ChartSectionDataTable } from './chart-section-data-table';
import type { ChartArtifact, ChartSpec } from '../../../api/chat-sse-client';
import {
  axisUnitLabel,
  columnAxisLabel,
  detectChartUnit,
  detectColumnUnit,
  formatAxisValue,
  formatReadableValue,
} from './format-chart-value';

const CHART_HEIGHT = 320;

interface AssistantChartSectionProps {
  artifact: ChartArtifact;
  /** When rendered inside a query-artifact card, suppress the chart's own title. */
  embedded?: boolean;
  /**
   * Optional controlled chart-type override. When set (e.g. from the
   * QueryArtifactCard menu), wins over the spec's declared type. Used only in
   * embedded mode; the standalone surface owns its own override state.
   */
  overrideType?: ChartSpec['type'];
}

export function AssistantChartSection({ artifact, embedded, overrideType: externalOverride }: AssistantChartSectionProps) {
  const { spec, truncated, originalRowCount } = artifact;
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [internalOverride, setInternalOverride] = useState<ChartSpec['type'] | null>(null);

  const overrideType = externalOverride ?? internalOverride;
  const activeType = overrideType ?? spec.type;
  const activeSpec = overrideType ? ({ ...spec, type: overrideType } as ChartSpec) : spec;

  // Embedded mode keeps the original minimal rendering — no header, no menu.
  if (embedded) {
    return (
      <div style={{ marginTop: 12, marginBottom: 0, padding: 0 }}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          {renderChartBody(activeSpec)}
        </ResponsiveContainer>
        {(spec.caption || truncated) && (
          <Footer spec={spec} truncated={truncated} originalRowCount={originalRowCount} />
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        marginBlock: 16,
        background: T.surface,
        border: `1px solid ${T.n200}`,
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* Header: title left, view-switcher right */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 24px',
          borderBottom: `1px solid ${T.n100}`,
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: T.fSans,
            fontSize: 14,
            fontWeight: 600,
            color: T.n900,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {spec.title}
        </div>
        <ChartSectionMenu
          spec={spec}
          view={view}
          activeType={activeType}
          rows={spec.data}
          onShowChart={() => setView('chart')}
          onShowTable={() => setView('table')}
          onChangeType={(t) => {
            setInternalOverride(t);
            setView('chart');
          }}
        />
      </div>

      {/* Body: chart or table — symmetric horizontal padding so content reads centered */}
      <div style={{ padding: '16px 24px' }}>
        {view === 'chart' ? (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            {renderChartBody(activeSpec)}
          </ResponsiveContainer>
        ) : (
          <ChartSectionDataTable rows={spec.data} spec={spec} />
        )}
        {(spec.caption || truncated) && (
          <Footer spec={spec} truncated={truncated} originalRowCount={originalRowCount} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Caption + truncation footer
// ---------------------------------------------------------------------------

interface FooterProps {
  spec: ChartSpec;
  truncated: boolean;
  originalRowCount: number;
}

function Footer({ spec, truncated, originalRowCount }: FooterProps) {
  return (
    <div
      style={{
        fontFamily: T.fSans,
        fontSize: 12,
        color: T.n500,
        marginTop: 8,
        lineHeight: 1.5,
      }}
    >
      {spec.caption}
      {spec.caption && truncated ? ' · ' : null}
      {truncated && (
        <span>
          Showing top {spec.data.length - 1} of {originalRowCount} — rest in “Other”.
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// renderChartBody — switch on spec.type → recharts component tree
// ---------------------------------------------------------------------------

function renderChartBody(spec: ChartSpec): React.ReactElement {
  // Unit detection drives axis ticks, tooltips, pie labels. Done once per
  // chart so detectUnit's regex work doesn't run per tick / per tooltip.
  const unit = detectChartUnit(spec);
  const axisTick = (v: number | string) => formatAxisValue(v, unit);
  const readable = (v: number | string) => formatReadableValue(v, unit);
  // Value-axis unit label so the reader sees what the numbers mean without
  // re-reading the title. Reused across every cartesian chart type below.
  const valueLabel = axisUnitLabel(spec);
  const valueAxisLabel = {
    value: valueLabel,
    angle: -90 as const,
    position: 'insideLeft' as const,
    style: { textAnchor: 'middle' as const, fill: T.n500, fontSize: 11 },
  };
  // Horizontal bar puts the value on the X axis, so its label sits at the bottom.
  const valueXAxisLabel = {
    value: valueLabel,
    position: 'insideBottom' as const,
    offset: -2,
    style: { textAnchor: 'middle' as const, fill: T.n500, fontSize: 11 },
  };
  // Left margin reserves room for the rotated Y-axis label.
  const cartesianMargin = { top: 8, right: 16, left: 16, bottom: 4 };
  // Recharts tooltip formatter signature: (value, name) → [display, name].
  // Returning the original `name` preserves the series label.
  const tooltipFormatter = (value: number | string, name: string) =>
    [readable(value), name] as [string, string];
  const pieLabel = ({ name, value }: { name: string; value: number }) =>
    `${name}: ${readable(value)}`;

  switch (spec.type) {
    case 'bar':
      return (
        <BarChart data={spec.data} margin={cartesianMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.n200} />
          <XAxis dataKey={spec.encoding.category} stroke={T.n500} fontSize={11} />
          <YAxis stroke={T.n500} fontSize={11} tickFormatter={axisTick} label={valueAxisLabel} />
          <Tooltip formatter={tooltipFormatter} />
          <Bar dataKey={spec.encoding.value} fill={CHART[0]} />
        </BarChart>
      );

    case 'horizontal-bar':
      return (
        <BarChart data={spec.data} layout="vertical" margin={cartesianMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.n200} />
          <XAxis
            type="number"
            stroke={T.n500}
            fontSize={11}
            tickFormatter={axisTick}
            label={valueXAxisLabel}
          />
          <YAxis
            dataKey={spec.encoding.category}
            type="category"
            stroke={T.n500}
            fontSize={11}
            width={120}
          />
          <Tooltip formatter={tooltipFormatter} />
          <Bar dataKey={spec.encoding.value} fill={CHART[0]} />
        </BarChart>
      );

    case 'stacked-bar': {
      const wide = pivotForSeries(spec.data, spec.encoding);
      const seriesKeys = uniqueSeriesValues(spec.data, spec.encoding.series);
      return (
        <BarChart data={wide} margin={cartesianMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.n200} />
          <XAxis dataKey={spec.encoding.category} stroke={T.n500} fontSize={11} />
          <YAxis stroke={T.n500} fontSize={11} tickFormatter={axisTick} label={valueAxisLabel} />
          <Tooltip formatter={tooltipFormatter} />
          <Legend />
          {seriesKeys.map((s, i) => (
            <Bar key={s} dataKey={s} stackId="a" fill={CHART[i % CHART.length]} />
          ))}
        </BarChart>
      );
    }

    case 'grouped-bar': {
      // Side-by-side bars per series value (e.g. IOS vs Android) — no stackId,
      // so recharts groups one bar per series within each category. Reads as a
      // direct magnitude comparison, unlike stacked (part-of-whole) or lines.
      const wide = pivotForSeries(spec.data, spec.encoding);
      const seriesKeys = uniqueSeriesValues(spec.data, spec.encoding.series);
      return (
        <BarChart data={wide} margin={cartesianMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.n200} />
          <XAxis dataKey={spec.encoding.category} stroke={T.n500} fontSize={11} />
          <YAxis stroke={T.n500} fontSize={11} tickFormatter={axisTick} label={valueAxisLabel} />
          <Tooltip formatter={tooltipFormatter} />
          <Legend />
          {seriesKeys.map((s, i) => (
            <Bar key={s} dataKey={s} fill={CHART[i % CHART.length]} />
          ))}
        </BarChart>
      );
    }

    case 'line':
      return (
        <LineChart data={spec.data} margin={cartesianMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.n200} />
          <XAxis dataKey={spec.encoding.category} stroke={T.n500} fontSize={11} />
          <YAxis stroke={T.n500} fontSize={11} tickFormatter={axisTick} label={valueAxisLabel} />
          <Tooltip formatter={tooltipFormatter} />
          <Line
            type="monotone"
            dataKey={spec.encoding.value}
            stroke={CHART[0]}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      );

    case 'multi-line': {
      const wide = pivotForSeries(spec.data, spec.encoding);
      const seriesKeys = uniqueSeriesValues(spec.data, spec.encoding.series);
      return (
        <LineChart data={wide} margin={cartesianMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.n200} />
          <XAxis dataKey={spec.encoding.category} stroke={T.n500} fontSize={11} />
          <YAxis stroke={T.n500} fontSize={11} tickFormatter={axisTick} label={valueAxisLabel} />
          <Tooltip formatter={tooltipFormatter} />
          <Legend />
          {seriesKeys.map((s, i) => (
            <Line
              key={s}
              type="monotone"
              dataKey={s}
              stroke={CHART[i % CHART.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      );
    }

    case 'area':
      return (
        <AreaChart data={spec.data} margin={cartesianMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.n200} />
          <XAxis dataKey={spec.encoding.category} stroke={T.n500} fontSize={11} />
          <YAxis stroke={T.n500} fontSize={11} tickFormatter={axisTick} label={valueAxisLabel} />
          <Tooltip formatter={tooltipFormatter} />
          <Area
            type="monotone"
            dataKey={spec.encoding.value}
            stroke={CHART[0]}
            fill={CHART[0]}
            fillOpacity={0.25}
          />
        </AreaChart>
      );

    case 'pie':
    case 'donut':
      return (
        <PieChart>
          <Pie
            data={spec.data}
            dataKey={spec.encoding.value}
            nameKey={spec.encoding.category}
            cx="50%"
            cy="50%"
            outerRadius={110}
            innerRadius={spec.type === 'donut' ? 60 : 0}
            label={pieLabel}
          >
            {spec.data.map((_row, i) => (
              <Cell key={i} fill={CHART[i % CHART.length]} />
            ))}
          </Pie>
          <Tooltip formatter={tooltipFormatter} />
          <Legend />
        </PieChart>
      );

    case 'scatter': {
      // Scatter plots two metrics against each other (e.g. ARPU vs paying-rate),
      // so X and Y are independent numeric columns that may carry different
      // units — detect each axis separately instead of reusing the single
      // value-column unit.
      const xUnit = detectColumnUnit(spec.encoding.category, spec);
      const yUnit = detectColumnUnit(spec.encoding.value, spec);
      // The point-identity column (e.g. country) is whatever data column isn't
      // an axis metric — label each dot with it so the reader knows which point
      // is which, the way a "X vs Y per entity" question expects.
      const labelKey = scatterLabelKey(spec.data, spec.encoding);
      const scatterTooltip = (value: number | string, name: string) => {
        const u = name === spec.encoding.category ? xUnit : name === spec.encoding.value ? yUnit : unit;
        return [formatReadableValue(value, u), name] as [string, string];
      };
      return (
        <ScatterChart margin={{ top: 12, right: 20, left: 16, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.n200} />
          <XAxis
            dataKey={spec.encoding.category}
            type="number"
            stroke={T.n500}
            fontSize={11}
            tickFormatter={(v) => formatAxisValue(v, xUnit)}
            label={{
              value: columnAxisLabel(spec.encoding.category, spec),
              position: 'insideBottom',
              offset: -8,
              style: { textAnchor: 'middle', fill: T.n500, fontSize: 11 },
            }}
          />
          <YAxis
            dataKey={spec.encoding.value}
            type="number"
            stroke={T.n500}
            fontSize={11}
            tickFormatter={(v) => formatAxisValue(v, yUnit)}
            label={valueAxisLabel}
          />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={scatterTooltip} />
          <Scatter data={spec.data} fill={CHART[0]}>
            {labelKey && (
              <LabelList dataKey={labelKey} position="top" style={{ fill: T.n600, fontSize: 10 }} />
            )}
          </Scatter>
        </ScatterChart>
      );
    }

    case 'funnel':
      // Rows render top-to-bottom in submitted (step) order, widths
      // proportional to value. Step label on the right, value on the left.
      return (
        <FunnelChart>
          <Tooltip formatter={tooltipFormatter} />
          <Funnel dataKey={spec.encoding.value} data={spec.data} isAnimationActive={false}>
            <LabelList
              position="right"
              dataKey={spec.encoding.category}
              stroke="none"
              fill={T.n900}
              fontSize={12}
            />
            <LabelList
              position="left"
              dataKey={spec.encoding.value}
              stroke="none"
              fill={T.n500}
              fontSize={11}
              formatter={readable}
            />
            {spec.data.map((_row, i) => (
              <Cell key={i} fill={CHART[i % CHART.length]} />
            ))}
          </Funnel>
        </FunnelChart>
      );
  }
}

/**
 * The data column that identifies each scatter point — the first column that is
 * neither the x metric (`category`) nor the y metric (`value`). For "ARPU vs
 * paying-rate per country" that's `country`, so each dot can be labelled.
 * Returns undefined when the rows carry only the two axis columns.
 */
export function scatterLabelKey(
  rows: Array<Record<string, string | number>>,
  encoding: { category: string; value: string },
): string | undefined {
  return Object.keys(rows[0] ?? {}).find(
    (k) => k !== encoding.category && k !== encoding.value,
  );
}

// ---------------------------------------------------------------------------
// Pivot helpers (stacked-bar / multi-line)
// ---------------------------------------------------------------------------

function pivotForSeries(
  rows: Array<Record<string, string | number>>,
  encoding: { category: string; value: string; series?: string },
): Array<Record<string, string | number>> {
  // Zod enforces series on stacked-bar/multi-line, but a bad payload shouldn't NPE the renderer.
  const seriesCol = encoding.series ?? '__series__';
  const byCategory = new Map<string | number, Record<string, string | number>>();
  for (const row of rows) {
    const cat = row[encoding.category];
    const seriesVal = String(row[seriesCol] ?? 'series');
    const value = Number(row[encoding.value]) || 0;

    const existing = byCategory.get(cat) ?? { [encoding.category]: cat };
    existing[seriesVal] = ((existing[seriesVal] as number) ?? 0) + value;
    byCategory.set(cat, existing);
  }
  return Array.from(byCategory.values());
}

function uniqueSeriesValues(
  rows: Array<Record<string, string | number>>,
  seriesCol: string | undefined,
): string[] {
  const col = seriesCol ?? '__series__';
  const set = new Set<string>();
  for (const row of rows) set.add(String(row[col] ?? 'series'));
  return Array.from(set);
}
