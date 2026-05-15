import { useEffect, useMemo, useState } from 'react';
import { Alert } from 'antd';
import { Flow, Paragraph, Title } from '@cube-dev/ui-kit';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Query, ResultSet } from '@cubejs-client/core';

import { useQueryBuilderContext } from '../context';

import { bucket, summarise, Bin } from './distribution-bucket';
import { DistributionInputs } from './distribution-inputs';
import { DistributionStats } from './distribution-stats';
import { EmptyState } from './empty-state';
import { detectDistributionInputs, detectSampleCube } from './sample-detector';

const DEFAULT_BINS = 10;
const ROW_WARNING_LIMIT = 10_000;
const DEBOUNCE_MS = 300;
const BAR_FILL = '#7A77FF';

function shortName(name: string): string {
  const parts = name.split('.');
  return parts[parts.length - 1] || name;
}

export function DistributionMode() {
  const { query, cubeApi, joinableMembers, mutexObj, meta, usedCubes } = useQueryBuilderContext();

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

  const sampleCube = useMemo(() => detectSampleCube(meta, usedCubes), [meta, usedCubes]);
  const sample = useMemo(() => detectDistributionInputs(sampleCube), [sampleCube]);

  const [measure, setMeasure] = useState<string | undefined>();
  const [groupDim, setGroupDim] = useState<string | undefined>();
  const [binCount, setBinCount] = useState<number>(DEFAULT_BINS);
  const [rows, setRows] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTrySample = () => {
    if (!sample) return;
    setMeasure(sample.measure);
  };

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
      <EmptyState
        title="Distribution"
        description="Histogram a numeric measure. Bins are computed in the browser; group by an optional dimension to stack."
        helpBullets={[
          'Pick a numeric measure to bin (e.g. revenue, duration).',
          'Adjust bin count to control resolution (2–50).',
          'Optional Group by stacks bars per category.',
        ]}
        onTrySample={handleTrySample}
        canTrySample={!!sample}
        disabledReason="No numeric measure found in the current schema."
      />
    );
  }

  const values: number[] = rows
    .map((row) => Number(row?.[measure]))
    .filter((v) => Number.isFinite(v));

  const bins: Bin[] = bucket(values, binCount);
  const stats = summarise(values);

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
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer>
          <BarChart data={bins} barCategoryGap={2}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={64} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill={BAR_FILL}>
              {bins.map((_, idx) => (
                <Cell key={idx} fill={BAR_FILL} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DistributionStats stats={stats} />
      {isLoading && <Paragraph color="#dark-03">Loading…</Paragraph>}
    </Flow>
  );
}
