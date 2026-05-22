import { useEffect, useMemo, useState } from 'react';
import { Alert, Switch } from 'antd';
import { Flow, Paragraph, Title } from '@cube-dev/ui-kit';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Query, ResultSet } from '@cubejs-client/core';

import { useQueryBuilderContext } from '../context';

import { bucket, bucketByGroup, summarise, Bin } from './distribution-bucket';

// Stacked-bar palette — same 8-step sequence used elsewhere in QB. Falls back
// to BAR_FILL when more groups appear than colors (rare; group cap is 8).
const STACK_COLORS = [
  '#7A77FF',
  '#3DA4FF',
  '#23C9C7',
  '#3FB562',
  '#F2C548',
  '#F08A3E',
  '#E45266',
  '#9E73E0',
];
import { DistributionInputs } from './distribution-inputs';
import { DistributionStats } from './distribution-stats';

const DEFAULT_BINS = 10;
const ROW_WARNING_LIMIT = 10_000;
const DEBOUNCE_MS = 300;
const BAR_FILL = '#7A77FF';

function shortName(name: string): string {
  const parts = name.split('.');
  return parts[parts.length - 1] || name;
}

export function DistributionMode() {
  const { query, cubeApi, joinableMembers, mutexObj } = useQueryBuilderContext();

  const numericMeasures = useMemo(
    () =>
      Object.values(joinableMembers.measures).filter((m: any) => {
        if (!m?.name || m.name.endsWith('.count')) return true;
        return m.type === 'number';
      }) as any[],
    [joinableMembers]
  );

  const categoricalDims = useMemo(
    () =>
      Object.values(joinableMembers.dimensions).filter(
        (d: any) => d?.type === 'string' || d?.type === 'number'
      ) as any[],
    [joinableMembers]
  );

  // Pre-fill from the current query so the user lands on a populated chart
  // when their query already has a numeric measure / categorical dimension.
  const queryMeasure = useMemo(
    () => (query.measures ?? []).find((m) => numericMeasures.some((nm) => nm.name === m)),
    [query.measures, numericMeasures]
  );
  const queryGroupDim = useMemo(
    () => (query.dimensions ?? []).find((d) => categoricalDims.some((cd) => cd.name === d)),
    [query.dimensions, categoricalDims]
  );

  const [measure, setMeasure] = useState<string | undefined>(queryMeasure);
  const [groupDim, setGroupDim] = useState<string | undefined>(queryGroupDim);
  const [binCount, setBinCount] = useState<number>(DEFAULT_BINS);
  const [logScale, setLogScale] = useState<boolean>(false);
  const [rows, setRows] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the last value we adopted from the query so we don't clobber an
  // explicit user override every time the upstream query changes.
  const [adoptedMeasure, setAdoptedMeasure] = useState(queryMeasure);
  const [adoptedGroupDim, setAdoptedGroupDim] = useState(queryGroupDim);
  useEffect(() => {
    if (queryMeasure && queryMeasure !== adoptedMeasure) {
      setMeasure(queryMeasure);
      setAdoptedMeasure(queryMeasure);
    }
  }, [queryMeasure, adoptedMeasure]);
  useEffect(() => {
    if (queryGroupDim && queryGroupDim !== adoptedGroupDim) {
      setGroupDim(queryGroupDim);
      setAdoptedGroupDim(queryGroupDim);
    }
  }, [queryGroupDim, adoptedGroupDim]);

  useEffect(() => {
    if (!measure || !cubeApi) {
      setRows([]);
      return;
    }

    const timer = setTimeout(() => {
      const sampleDimCandidate = Object.values(joinableMembers.dimensions).find(
        (d: any) => d?.type === 'string'
      ) as any;

      const dims = [groupDim, sampleDimCandidate?.name].filter(Boolean) as string[];

      const distQuery: Query = {
        measures: [measure],
        dimensions: dims,
        filters: query.filters,
        limit: 10_000,
      };

      setIsLoading(true);
      setError(null);

      cubeApi
        .load(distQuery, { mutexObj, mutexKey: 'distribution' })
        .then((result: ResultSet) => {
          setIsLoading(false);
          setRows(result.rawData());
        })
        .catch((err: any) => {
          setIsLoading(false);
          setError(err?.message ?? String(err));
          setRows([]);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [measure, groupDim, JSON.stringify(query.filters), cubeApi]);

  if (!measure) {
    return (
      <Flow gap="1x">
        <Title level={5} preset="t3">
          Distribution
        </Title>
        <Paragraph color="#dark-03">
          {numericMeasures.length === 0
            ? 'No numeric measure available in the current schema.'
            : 'Pick a numeric measure to histogram. Optional Group by stacks bars per category.'}
        </Paragraph>
        <DistributionInputs
          measure={measure}
          binCount={binCount}
          groupDim={groupDim}
          numericMeasures={numericMeasures}
          categoricalDims={categoricalDims}
          onMeasureChange={setMeasure}
          onBinCountChange={setBinCount}
          onGroupDimChange={setGroupDim}
        />
      </Flow>
    );
  }

  const values: number[] = rows
    .map((row) => Number(row?.[measure]))
    .filter((v) => Number.isFinite(v));

  const stats = summarise(values);
  // When Group by is active, bucket per-group so the chart actually shows
  // channel composition (was a no-op before).
  const groupedResult = groupDim
    ? bucketByGroup(rows as Record<string, unknown>[], measure, groupDim, binCount)
    : null;
  const bins: Bin[] = groupedResult ? groupedResult.bins : bucket(values, binCount);

  return (
    <Flow gap="1x">
      <Title level={5} preset="t3">
        Distribution of <b>{shortName(measure)}</b>
        {groupDim ? <> grouped by <b>{shortName(groupDim)}</b></> : null}
      </Title>
      <DistributionInputs
        measure={measure}
        binCount={binCount}
        groupDim={groupDim}
        numericMeasures={numericMeasures}
        categoricalDims={categoricalDims}
        onMeasureChange={setMeasure}
        onBinCountChange={setBinCount}
        onGroupDimChange={setGroupDim}
      />
      {error && <Alert type="error" message={error} />}
      {values.length > ROW_WARNING_LIMIT && (
        <Alert
          type="warning"
          message={`Loaded ${values.length.toLocaleString()} rows. Browser bucketing may lag — narrow filters to improve performance.`}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
        <Paragraph color="#dark-03" preset="c2" style={{ margin: 0 }}>
          Log Y
        </Paragraph>
        <Switch
          size="small"
          checked={logScale}
          onChange={setLogScale}
          aria-label="Toggle log-scale Y axis"
        />
      </div>
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer>
          <BarChart data={bins} barCategoryGap={2}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={64} />
            <YAxis
              allowDecimals={false}
              scale={logScale ? 'log' : 'auto'}
              domain={logScale ? [1, 'auto'] : [0, 'auto']}
              allowDataOverflow={logScale}
            />
            <Tooltip />
            {groupedResult ? (
              <>
                <Legend />
                {groupedResult.groups.map((g, i) => (
                  <Bar
                    key={g}
                    dataKey={g}
                    stackId="dist"
                    fill={STACK_COLORS[i % STACK_COLORS.length]}
                    name={g}
                  />
                ))}
              </>
            ) : (
              <Bar dataKey="count" fill={BAR_FILL}>
                {bins.map((_, idx) => (
                  <Cell key={idx} fill={BAR_FILL} />
                ))}
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DistributionStats stats={stats} />
      {isLoading && <Paragraph color="#dark-03">Loading…</Paragraph>}
    </Flow>
  );
}
