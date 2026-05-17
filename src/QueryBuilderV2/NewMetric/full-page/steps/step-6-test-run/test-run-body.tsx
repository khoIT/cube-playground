import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { notification } from 'antd';
import { Play, Loader, RefreshCw, CheckCircle } from 'lucide-react';
import { useHistory } from 'react-router-dom';
import type { CubeApi } from '@cubejs-client/core';
import type { NewMetricDraftV2 } from '../../../types';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import { generateV2 } from '../../../yaml/generate-measure-yaml';
import { postSchemaWrite, deleteSchemaWrite } from '../../../api';
import { useTestRun } from './use-test-run';
import { TrendChart, DimensionTable } from './test-run-charts';
import { removePending } from './pending-writes';

const StatusPill = styled.span<{ $kind: 'pass' | 'pending' | 'error' }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  background: ${(p) =>
    p.$kind === 'pass'
      ? 'rgba(34, 197, 94, 0.12)'
      : p.$kind === 'error'
      ? 'rgba(239, 68, 68, 0.10)'
      : 'rgba(63, 141, 255, 0.10)'};
  color: ${(p) =>
    p.$kind === 'pass' ? 'var(--success)' : p.$kind === 'error' ? 'var(--danger)' : 'var(--info)'};
`;
const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
`;
const RangeRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
`;
const RangeTabs = styled.div`
  display: flex;
  background: var(--bg-muted);
  border-radius: 8px;
  padding: 2px;
`;
const RangeTab = styled.button<{ $active: boolean }>`
  padding: 5px 12px;
  border-radius: 6px;
  border: none;
  font-size: 12px;
  font-weight: 500;
  background: ${(p) => (p.$active ? 'var(--bg-card)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--text-primary)' : 'var(--text-secondary)')};
  cursor: pointer;
  box-shadow: ${(p) => (p.$active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none')};
`;
const Rerun = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--border-card);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
  &:hover { background: var(--bg-muted); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const StatGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 14px;
`;
const Stat = styled.div`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 12px;
  padding: 14px 16px;
`;
const StatLabel = styled.div`
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
`;
const StatValue = styled.div`
  font-size: 26px;
  font-weight: 700;
  margin-top: 4px;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
`;
const StatSub = styled.div`
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 4px;
`;
const ChartsGrid = styled.div`
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 12px;
  margin-top: 14px;
`;
const SubmitBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--border-card);
`;
const Primary = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--brand);
  color: white;
  border: none;
  padding: 9px 18px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  &:hover { background: var(--brand-hover); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

function formatScalar(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

export type TestRunBodyProps = {
  draft: NewMetricDraftV2;
  sourceCube: WizardCube | null;
  cubejsApi: CubeApi | null;
  onSubmitted: (info: { cubeName: string; measureName: string }) => void;
};

export function TestRunBody({ draft, sourceCube, cubejsApi, onSubmitted }: TestRunBodyProps) {
  const history = useHistory();
  const primaryCube = draft.sourceCubes[0] ?? null;

  // Auto-pick first time-typed dimension on the source cube if the draft has
  // none yet. Falls back to scalar-only render when no time dim exists.
  const timeDimOptions = useMemo(() => {
    const dims = sourceCube?.dimensions ?? [];
    return dims.filter((d) => d.type === 'time').map((d) => d.name);
  }, [sourceCube]);
  const nonTimeDimOptions = useMemo(() => {
    const dims = sourceCube?.dimensions ?? [];
    return dims.filter((d) => d.type !== 'time').map((d) => d.name);
  }, [sourceCube]);

  const [timeDim, setTimeDim] = useState<string | null>(null);
  const [range, setRange] = useState<'7d' | '30d'>(draft.previewRange || '30d');
  const [breakdownDim, setBreakdownDim] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!timeDim && timeDimOptions.length > 0) setTimeDim(timeDimOptions[0]);
  }, [timeDim, timeDimOptions]);
  useEffect(() => {
    if (!breakdownDim && nonTimeDimOptions.length > 0) setBreakdownDim(nonTimeDimOptions[0]);
  }, [breakdownDim, nonTimeDimOptions]);

  const yamlFragment = useMemo(() => {
    if (!primaryCube) return '';
    try {
      const { fragment } = generateV2(draft, {
        sourceCube: primaryCube,
        reachableMembers: [],
        peerMeasureNames: (sourceCube?.measures ?? []).map((m) => m.name.split('.').slice(-1)[0]),
      });
      return fragment;
    } catch {
      return '';
    }
  }, [draft, sourceCube, primaryCube]);

  const run = useTestRun({
    cubejsApi,
    cubeName: primaryCube,
    measureName: draft.name,
    yamlPatch: yamlFragment,
    timeDimension: timeDim,
    range,
    breakdownDimension: breakdownDim,
    refreshKey,
  });

  const isLoadingPreview =
    run.previewStatus === 'writing' ||
    run.previewStatus === 'loading' ||
    run.previewStatus === 'discarding-prior';
  const hasPreview = run.previewStatus === 'success';

  async function handleSubmit() {
    if (!primaryCube || !draft.name) {
      notification.error({ message: 'Missing required fields' });
      return;
    }
    setSubmitting(true);

    // The live preview already committed the YAML to disk. Skip the duplicate
    // write when the on-disk identity matches what Submit would write.
    const alreadyCommitted =
      run.lastWritten &&
      run.lastWritten.cubeName === primaryCube &&
      run.lastWritten.measureName === draft.name &&
      run.previewStatus === 'success';

    if (!alreadyCommitted) {
      const result = await postSchemaWrite({
        cubeName: primaryCube,
        measureName: draft.name,
        yamlPatch: yamlFragment,
      });
      if (result.ok && result.warning === 'meta-not-acknowledged') {
        await deleteSchemaWrite({ cubeName: primaryCube, measureName: draft.name });
        notification.warning({
          message: 'Cube hot-reload timed out',
          description: 'Changes were rolled back. Re-run when the cube is responsive.',
        });
        setSubmitting(false);
        return;
      }
      if (!result.ok) {
        const status = 'status' in result ? result.status : 'unknown';
        const reason = 'reason' in result ? result.reason : 'unknown';
        notification.error({ message: 'Submit failed', description: `${status}: ${reason}` });
        setSubmitting(false);
        return;
      }
    }

    // Promote the YAML from "pending" to permanent — the file stays on disk
    // and should no longer be auto-discarded on next wizard mount or Discard.
    removePending({ cubeName: primaryCube, measureName: draft.name });
    onSubmitted({ cubeName: primaryCube, measureName: draft.name });
    notification.success({ message: 'Metric submitted' });
    history.push(
      `/metrics/new/success?name=${encodeURIComponent(draft.name)}&cubeName=${encodeURIComponent(primaryCube)}`,
    );
  }

  return (
    <>
      <HeaderRow>
        {run.previewStatus === 'success' && (
          <StatusPill $kind="pass">
            <CheckCircle size={12} /> Passed{run.stats.queryMs ? ` in ${run.stats.queryMs} ms` : ''}
          </StatusPill>
        )}
        {isLoadingPreview && (
          <StatusPill $kind="pending">
            <Loader size={12} className="spin" /> Compiling…
          </StatusPill>
        )}
        {run.previewStatus === 'error' && (
          <StatusPill $kind="error">Failed — see error below</StatusPill>
        )}
        <RangeRow>
          <RangeTabs>
            <RangeTab $active={range === '7d'} onClick={() => setRange('7d')}>Last 7 d</RangeTab>
            <RangeTab $active={range === '30d'} onClick={() => setRange('30d')}>Last 30 d</RangeTab>
          </RangeTabs>
          <Rerun onClick={() => setRefreshKey((k) => k + 1)} disabled={isLoadingPreview}>
            <RefreshCw size={12} /> Re-run
          </Rerun>
        </RangeRow>
      </HeaderRow>

      <StatGrid>
        <Stat>
          <StatLabel>Metric value · {range === '7d' ? 'last 7 d' : 'last 30 d'}</StatLabel>
          <StatValue>{hasPreview ? formatScalar(run.stats.scalar) : '—'}</StatValue>
          <StatSub>{timeDim ? `Aggregated over ${run.stats.pointsReturned} days` : 'Scalar (no time dim)'}</StatSub>
        </Stat>
        <Stat>
          <StatLabel>Rows returned</StatLabel>
          <StatValue>{hasPreview ? run.stats.pointsReturned.toLocaleString() : '—'}</StatValue>
          <StatSub>{run.dimension.status === 'success' ? `${run.dimension.rows.length} dimension groups` : 'from cube /v1/load'}</StatSub>
        </Stat>
        <Stat>
          <StatLabel>Query time</StatLabel>
          <StatValue>{run.stats.queryMs != null ? `${run.stats.queryMs} ms` : '—'}</StatValue>
          <StatSub>Round-trip including schema write</StatSub>
        </Stat>
      </StatGrid>

      {run.previewError && (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 8,
          background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', fontSize: 12.5,
        }}>
          {run.previewError}
        </div>
      )}

      <ChartsGrid>
        <TrendChart
          data={run.series}
          loading={isLoadingPreview}
          rangeLabel={`daily · ${range === '7d' ? 'last 7 d' : 'last 30 d'}`}
        />
        <DimensionTable
          result={run.dimension}
          dimensions={nonTimeDimOptions}
          activeDimension={breakdownDim}
          onPick={setBreakdownDim}
        />
      </ChartsGrid>

      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
          Preview YAML fragment
        </summary>
        <pre style={{
          fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--bg-muted)',
          padding: 12, borderRadius: 10, marginTop: 8, whiteSpace: 'pre-wrap',
        }}>{yamlFragment || '—'}</pre>
      </details>

      <SubmitBar>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {hasPreview
            ? 'Test run passed — submit when you are ready.'
            : 'Submit becomes available once the test run completes.'}
        </div>
        <Primary onClick={handleSubmit} disabled={submitting || !hasPreview || !draft.name || !primaryCube}>
          <Play size={14} /> {submitting ? 'Submitting…' : 'Submit metric request'}
        </Primary>
      </SubmitBar>
    </>
  );
}
