/**
 * AssistantChartSection — renders a ChartArtifact with recharts.
 *
 * The component compiles the declarative spec into the appropriate recharts
 * subtree at render time. No echarts dep, no custom canvas — just JSX from
 * recharts primitives.
 *
 * Layout:
 *   Title (unless `embedded` — embedded charts inherit the artifact card's title)
 *   <ResponsiveContainer height={320}> …chart… </ResponsiveContainer>
 *   Caption + truncation footer
 */
import React from 'react';
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
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { T, CHART } from '../../../shell/theme';
import type { ChartArtifact, ChartSpec } from '../../../api/chat-sse-client';

const CHART_HEIGHT = 320;

interface AssistantChartSectionProps {
  artifact: ChartArtifact;
  /** When rendered inside a query-artifact card, suppress the chart's own title. */
  embedded?: boolean;
}

export function AssistantChartSection({ artifact, embedded }: AssistantChartSectionProps) {
  const { spec, truncated, originalRowCount } = artifact;

  return (
    <div
      style={{
        marginTop: embedded ? 12 : 16,
        marginBottom: embedded ? 0 : 16,
        padding: embedded ? 0 : 16,
        background: embedded ? 'transparent' : T.surface,
        border: embedded ? 'none' : `1px solid ${T.n200}`,
        borderRadius: embedded ? 0 : 8,
      }}
    >
      {!embedded && (
        <div
          style={{
            fontFamily: T.fSans,
            fontSize: 14,
            fontWeight: 600,
            color: T.n900,
            marginBottom: 8,
          }}
        >
          {spec.title}
        </div>
      )}

      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        {renderChartBody(spec)}
      </ResponsiveContainer>

      {(spec.caption || truncated) && (
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
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// renderChartBody — switch on spec.type → recharts component tree
// ---------------------------------------------------------------------------

function renderChartBody(spec: ChartSpec): React.ReactElement {
  switch (spec.type) {
    case 'bar':
      return (
        <BarChart data={spec.data}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.n200} />
          <XAxis dataKey={spec.encoding.category} stroke={T.n500} fontSize={11} />
          <YAxis stroke={T.n500} fontSize={11} />
          <Tooltip />
          <Bar dataKey={spec.encoding.value} fill={CHART[0]} />
        </BarChart>
      );

    case 'horizontal-bar':
      return (
        <BarChart data={spec.data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke={T.n200} />
          <XAxis type="number" stroke={T.n500} fontSize={11} />
          <YAxis
            dataKey={spec.encoding.category}
            type="category"
            stroke={T.n500}
            fontSize={11}
            width={120}
          />
          <Tooltip />
          <Bar dataKey={spec.encoding.value} fill={CHART[0]} />
        </BarChart>
      );

    case 'stacked-bar': {
      // Pivot wide: build one row per category with one column per series value.
      const wide = pivotForSeries(spec.data, spec.encoding);
      const seriesKeys = uniqueSeriesValues(spec.data, spec.encoding.series);
      return (
        <BarChart data={wide}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.n200} />
          <XAxis dataKey={spec.encoding.category} stroke={T.n500} fontSize={11} />
          <YAxis stroke={T.n500} fontSize={11} />
          <Tooltip />
          <Legend />
          {seriesKeys.map((s, i) => (
            <Bar key={s} dataKey={s} stackId="a" fill={CHART[i % CHART.length]} />
          ))}
        </BarChart>
      );
    }

    case 'line':
      return (
        <LineChart data={spec.data}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.n200} />
          <XAxis dataKey={spec.encoding.category} stroke={T.n500} fontSize={11} />
          <YAxis stroke={T.n500} fontSize={11} />
          <Tooltip />
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
        <LineChart data={wide}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.n200} />
          <XAxis dataKey={spec.encoding.category} stroke={T.n500} fontSize={11} />
          <YAxis stroke={T.n500} fontSize={11} />
          <Tooltip />
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
        <AreaChart data={spec.data}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.n200} />
          <XAxis dataKey={spec.encoding.category} stroke={T.n500} fontSize={11} />
          <YAxis stroke={T.n500} fontSize={11} />
          <Tooltip />
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
            label
          >
            {spec.data.map((_row, i) => (
              <Cell key={i} fill={CHART[i % CHART.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      );

    case 'scatter':
      return (
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke={T.n200} />
          <XAxis
            dataKey={spec.encoding.category}
            type="number"
            stroke={T.n500}
            fontSize={11}
          />
          <YAxis
            dataKey={spec.encoding.value}
            type="number"
            stroke={T.n500}
            fontSize={11}
          />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={spec.data} fill={CHART[0]} />
        </ScatterChart>
      );
  }
}

// ---------------------------------------------------------------------------
// Pivot helpers (stacked-bar / multi-line)
// ---------------------------------------------------------------------------

function pivotForSeries(
  rows: Array<Record<string, string | number>>,
  encoding: { category: string; value: string; series?: string },
): Array<Record<string, string | number>> {
  // Defensive fallback — Zod enforces series on stacked-bar/multi-line, but a
  // bad payload shouldn't NPE the renderer.
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
