import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import styled from 'styled-components';
import { notification } from 'antd';
import { useHistory } from 'react-router-dom';
import { Loader, CheckCircle, Info } from 'lucide-react';
import type { CubeApi } from '@cubejs-client/core';
import type { NewMetricDraftV3 } from '../../../types';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import { generateEntry } from '../../../yaml/generate-cube-entry';
import { flattenToSql } from '../../../filter-tree';
import { postSchemaWrite, deleteSchemaWrite } from '../../../api';
import { addPending, removePending } from './pending-writes';
import type { TestRunControls } from './test-run-body';

const Wrap = styled.div`display: flex; flex-direction: column; gap: 14px;`;
const HeaderRow = styled.div`display: flex; align-items: center; gap: 12px;`;
const StatusPill = styled.span<{ $kind: 'pass' | 'pending' | 'error' }>`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500;
  background: ${(p) => p.$kind === 'pass' ? 'rgba(34,197,94,0.12)' : p.$kind === 'error' ? 'rgba(239,68,68,0.10)' : 'rgba(63,141,255,0.10)'};
  color: ${(p) => p.$kind === 'pass' ? 'var(--success)' : p.$kind === 'error' ? 'var(--danger)' : 'var(--info)'};
`;
const Block = styled.pre`
  background: var(--bg-muted); border: 1px solid var(--border-card); border-radius: 10px;
  padding: 12px; font-family: var(--font-mono); font-size: 12px;
  white-space: pre-wrap; word-break: break-word; margin: 0;
`;
const Note = styled.div`
  display: flex; gap: 8px; align-items: flex-start;
  padding: 10px 12px; border-radius: 8px;
  background: rgba(234, 179, 8, 0.10); color: #92400e; font-size: 12.5px;
  & svg { flex: none; margin-top: 2px; }
`;
const Tile = styled.div`
  background: var(--bg-card); border: 1px solid var(--border-card); border-radius: 12px;
  padding: 14px 16px;
`;
const TileLabel = styled.div`font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-secondary);`;
const TileValue = styled.div`font-size: 26px; font-weight: 700; margin-top: 4px; color: var(--text-primary); font-variant-numeric: tabular-nums;`;
const ErrBox = styled.div`
  padding: 10px 12px; border-radius: 8px;
  background: rgba(239,68,68,0.08); color: var(--danger); font-size: 12.5px;
`;

export type TestRunSegmentViewProps = {
  draft: NewMetricDraftV3;
  sourceCube: WizardCube | null;
  cubejsApi: CubeApi | null;
  controlsRef?: MutableRefObject<TestRunControls | null>;
  onReadyChange?: (ready: boolean) => void;
  onSubmitted: (info: { cubeName: string; entryName: string }) => void;
};

export function TestRunSegmentView(p: TestRunSegmentViewProps) {
  const history = useHistory();
  const primaryCube = p.draft.sourceCubes[0] ?? null;

  const emit = useMemo(() => {
    if (!primaryCube) return null;
    try {
      return generateEntry(p.draft, {
        sourceCube: primaryCube,
        reachableMembers: [],
        peerMeasureNames: [],
      });
    } catch (err) {
      return { yaml: `# emit error: ${err instanceof Error ? err.message : String(err)}`, fragment: '', sectionKey: 'segments' as const };
    }
  }, [p.draft, primaryCube]);

  const templateSql = useMemo(() => {
    try {
      return flattenToSql(p.draft.filterTree, primaryCube ?? undefined);
    } catch {
      return '';
    }
  }, [p.draft.filterTree, primaryCube]);

  const [status, setStatus] = useState<'idle' | 'writing' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [cohortCount, setCohortCount] = useState<number | null>(null);
  const [cohortError, setCohortError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const lastWrittenRef = useRef<{ cubeName: string; entryName: string } | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    if (!primaryCube || !p.draft.name || !emit?.fragment) return;
    const myId = ++runIdRef.current;
    const t = setTimeout(async () => {
      setStatus('writing'); setError(null);
      if (lastWrittenRef.current && (lastWrittenRef.current.cubeName !== primaryCube || lastWrittenRef.current.entryName !== p.draft.name)) {
        await deleteSchemaWrite({ cubeName: lastWrittenRef.current.cubeName, measureName: lastWrittenRef.current.entryName });
        lastWrittenRef.current = null;
      }
      const res = await postSchemaWrite({
        cubeName: primaryCube,
        entryName: p.draft.name,
        kind: 'segment',
        yamlPatch: emit.fragment,
      });
      if (myId !== runIdRef.current) return;
      if (!res.ok) {
        const reason = 'reason' in res ? res.reason : 'unknown';
        setStatus('error');
        setError(`write failed: ${reason}`);
        return;
      }
      addPending({ cubeName: primaryCube, measureName: p.draft.name });
      lastWrittenRef.current = { cubeName: primaryCube, entryName: p.draft.name };
      // Best-effort cohort-size: try a segments-scoped count. If unsupported in
      // this Cube version, we surface the error inline but stay in success
      // state so submit is unblocked (SQL-only fallback per spike-not-run).
      setStatus('success');
      setCohortCount(null);
      setCohortError(null);
      if (p.cubejsApi) {
        try {
          const qualified = `${primaryCube}.${p.draft.name}`;
          const r = await (p.cubejsApi as any).load({ measures: [`${primaryCube}.count`], segments: [qualified] });
          if (myId !== runIdRef.current) return;
          const raw = (r.rawData() as Array<Record<string, unknown>>)[0] ?? {};
          const val = Number(raw[`${primaryCube}.count`]);
          if (Number.isFinite(val)) setCohortCount(val);
        } catch (err) {
          if (myId !== runIdRef.current) return;
          setCohortError(err instanceof Error ? err.message : String(err));
        }
      }
    }, 500);
    return () => clearTimeout(t);
  }, [p.draft, emit?.fragment, p.cubejsApi, primaryCube]);

  const canSubmit = status === 'success' && !submitting && !!primaryCube && !!p.draft.name;
  useEffect(() => { p.onReadyChange?.(canSubmit); }, [canSubmit, p]);

  async function handleSubmit() {
    if (!primaryCube || !p.draft.name) return;
    setSubmitting(true);
    removePending({ cubeName: primaryCube, measureName: p.draft.name });
    p.onSubmitted({ cubeName: primaryCube, entryName: p.draft.name });
    notification.success({ message: 'Segment submitted' });
    history.push(
      `/metrics/new/success?name=${encodeURIComponent(p.draft.name)}&cubeName=${encodeURIComponent(primaryCube)}`,
    );
  }
  useEffect(() => {
    if (!p.controlsRef) return;
    p.controlsRef.current = { submit: handleSubmit };
    return () => { if (p.controlsRef?.current?.submit === handleSubmit) p.controlsRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.controlsRef, primaryCube, p.draft.name, status, submitting]);

  return (
    <Wrap>
      <HeaderRow>
        {status === 'success' && <StatusPill $kind="pass"><CheckCircle size={12} /> Segment wrote</StatusPill>}
        {status === 'writing' && <StatusPill $kind="pending"><Loader size={12} className="spin" /> writing…</StatusPill>}
        {status === 'error' && <StatusPill $kind="error">Failed</StatusPill>}
      </HeaderRow>

      {error && <ErrBox>{error}</ErrBox>}

      {cohortCount != null ? (
        <Tile>
          <TileLabel>Cohort size</TileLabel>
          <TileValue>{cohortCount.toLocaleString()}</TileValue>
        </Tile>
      ) : (
        <Note>
          <Info size={14} />
          <div>
            Cohort-size preview not available — segments-as-query-args spike not run.
            Falling back to SQL-only preview below.
            {cohortError && <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 11.5 }}>Cube error: {cohortError}</div>}
          </div>
        </Note>
      )}

      <div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          Segment definition (Cube template form)
        </div>
        <Block>{templateSql || '(empty filter tree)'}</Block>
      </div>

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
          Preview YAML fragment ({emit?.sectionKey})
        </summary>
        <Block>{emit?.fragment || '—'}</Block>
      </details>
    </Wrap>
  );
}
