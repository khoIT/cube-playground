import { useMemo } from 'react';
import { Block, Space } from '@cube-dev/ui-kit';
import { ChartType, PivotConfig, Query } from '@cubejs-client/core';

import { CopyButton } from '../../QueryBuilderV2/components/CopyButton';
import { ScrollableCodeContainer } from '../../QueryBuilderV2/components/ScrollableCodeContainer';
import { TabPaneWithToolbar } from '../../QueryBuilderV2/components/TabPaneWithToolbar';

type Props = {
  apiUrl?: string;
  apiToken?: string | null;
  query?: Query;
  pivotConfig?: PivotConfig | null;
  chartType?: ChartType;
};

function indent(value: string, level = 2): string {
  const pad = ' '.repeat(level);
  return value
    .split('\n')
    .map((line) => (line.length ? pad + line : line))
    .join('\n');
}

function buildReactSnippet({
  apiUrl,
  apiToken,
  query,
  pivotConfig,
  chartType,
}: {
  apiUrl: string;
  apiToken: string;
  query: Query;
  pivotConfig?: PivotConfig | null;
  chartType?: ChartType;
}): string {
  const queryLiteral = indent(JSON.stringify(query ?? {}, null, 2), 2).trimStart();
  const pivotLiteral = pivotConfig
    ? indent(JSON.stringify(pivotConfig, null, 2), 2).trimStart()
    : 'undefined';
  const safeChartType = chartType ?? 'line';

  return `import React from 'react';
import cube from '@cubejs-client/core';
import { useCubeQuery } from '@cubejs-client/react';
import {
  ResponsiveContainer,
  LineChart, BarChart, AreaChart,
  Line, Bar, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

const cubeApi = cube('${apiToken || '<YOUR_API_TOKEN>'}', {
  apiUrl: '${apiUrl || '<YOUR_API_URL>'}',
});

const query = ${queryLiteral};

const pivotConfig = ${pivotLiteral};

const CHART_BY_TYPE = { line: LineChart, bar: BarChart, area: AreaChart };
const SERIES_BY_TYPE = { line: Line, bar: Bar, area: Area };

export default function ChartRenderer() {
  const { resultSet, isLoading, error } = useCubeQuery(query, { cubeApi });

  if (isLoading) return <div>Loading…</div>;
  if (error) return <div>Error: {error.toString()}</div>;
  if (!resultSet) return null;

  const data = resultSet.chartPivot(pivotConfig);
  const series = resultSet.seriesNames(pivotConfig);

  const ChartComponent = CHART_BY_TYPE['${safeChartType}'] || LineChart;
  const SeriesComponent = SERIES_BY_TYPE['${safeChartType}'] || Line;

  return (
    <ResponsiveContainer width="100%" height={400}>
      <ChartComponent data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="x" />
        <YAxis />
        <Tooltip />
        <Legend />
        {series.map((s, i) => (
          <SeriesComponent
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={'#' + (((i + 1) * 0x456789) & 0xffffff).toString(16).padStart(6, '0')}
            fill={'#' + (((i + 1) * 0x456789) & 0xffffff).toString(16).padStart(6, '0')}
          />
        ))}
      </ChartComponent>
    </ResponsiveContainer>
  );
}
`;
}

export function PlaygroundVizard(props: Props) {
  const { apiUrl = '', apiToken = '', query = {} as Query, pivotConfig, chartType } = props;

  const reactCode = useMemo(
    () =>
      buildReactSnippet({
        apiUrl,
        apiToken: apiToken ?? '',
        query,
        pivotConfig,
        chartType,
      }),
    [apiUrl, apiToken, query, pivotConfig, chartType]
  );

  return (
    <Block padding="2x" height="(80vh - 8x)" width="80vw" styles={{ overflow: 'hidden' }}>
      <TabPaneWithToolbar
        actions={
          <Space gap="1x">
            <CopyButton type="secondary" value={reactCode}>
              Copy
            </CopyButton>
          </Space>
        }
      >
        <ScrollableCodeContainer value={reactCode} />
      </TabPaneWithToolbar>
    </Block>
  );
}
