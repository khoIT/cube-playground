import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import styled from 'styled-components';
import { notification } from 'antd';
import { useHistory } from 'react-router-dom';
import { Loader, CheckCircle } from 'lucide-react';
import type { CubeApi } from '@cubejs-client/core';
import type { NewMetricDraftV3 } from '../../../types';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import { generateEntry } from '../../../yaml/generate-cube-entry';
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
const Yaml = styled.pre`
  background: var(--bg-muted); border: 1px solid var(--border-card); border-radius: 10px;
  padding: 12px; font-family: var(--font-mono); font-size: 12px;
  white-space: pre-wrap; word-break: break-word; margin: 0;
`;
const Table = styled.div`
  background: var(--bg-card); border: 1px solid var(--border-card); border-radius: 10px;
  padding: 10px 12px;
`;
const Row = styled.div`
  display: grid; grid-template-columns: 1fr 80px 1fr; gap: 8px; align-items: center;
  font-size: 12.5px; font-family: var(--font-mono);
  padding: 4px 0;
  & + & { border-top: 1px dashed var(--border-card); }
`;
const Bar = styled.div<{ $share: number }>`
  height: 8px; border-radius: 4px; background: var(--brand-soft);
  position: relative;
  &::after {
    content: ''; position: absolute; inset: 0;
    width: ${(p) => Math.min(100, p.$share * 100)}%;
    background: var(--brand); border-radius: 4px;
  }
`;
const Empty = styled.div`color: var(--text-muted); font-size: 12.5px; padding: 16px;`;
const ErrBox = styled.div`
  padding: 10px 12px; border-radius: 8px;
  background: rgba(239,68,68,0.08); color: var(--danger); font-size: 12.5px;
`;

export type TestRunDimensionViewProps = {
  draft: NewMetricDraftV3;
  sourceCube: WizardCube | null;
  cubejsApi: CubeApi | null;
  controlsRef?: MutableRefObject<TestRunControls | null>;
  onReadyChange?: (ready: boolean) => void;
  onSubmitted: (info: { cubeName: string; entryName: string }) => void;
};

type RowData = { label: string; count: number; share: number };

export function TestRunDimensionView(p: TestRunDimensionViewProps) {
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
      return { yaml: `# emit error: ${err instanceof Error ? err.message : String(err)}`, fragment: '', sectionKey: 'dimensions' as const };
    }
  }, [p.draft, primaryCube]);

  const [status, setStatus] = useState<'idle' | 'writing' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RowData[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const lastWrittenRef = useRef<{ cubeName: string; entryName: string } | null>(null);
  const runIdRef = useRef(0);

  // Write + load on draft change (debounced lightly).
  useEffect(() => {
    if (!primaryCube || !p.draft.name || !emit?.fragment) return;
    const myId = ++runIdRef.current;
    const t = setTimeout(async () => {
      setStatus('writing');
      setError(null);
      // Restore prior backup if identity changed
      if (lastWrittenRef.current && (lastWrittenRef.current.cubeName !== primaryCube || lastWrittenRef.current.entryName !== p.draft.name)) {
        await deleteSchemaWrite({ cubeName: lastWrittenRef.current.cubeName, measureName: lastWrittenRef.current.entryName });
        lastWrittenRef.current = null;
      }
      const res = await postSchemaWrite({
        cubeName: primaryCube,
        entryName: p.draft.name,
        kind: 'dimension',
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
      setStatus('loading');
      // Top-N query
      if (!p.cubejsApi) { setStatus('success'); setRows([]); return; }
      try {
        const qualified = `${primaryCube}.${p.draft.name}`;
        const r = await p.cubejsApi.load({ dimensions: [qualified], limit: 25 });
        if (myId !== runIdRef.current) return;
        const raw = r.rawData() as Array<Record<string, unknown>>;
        const labels = raw.map((row) => String(row[qualified] ?? '(null)'));
        // Without a count measure we can only show distinct labels — use 1 each.
        const total = labels.length;
        const next: RowData[] = labels.map((l) => ({ label: l, count: 1, share: total > 0 ? 1 / total : 0 }));
        setRows(next);
        setStatus('success');
      } catch (err) {
        if (myId !== runIdRef.current) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
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
    notification.success({ message: 'Dimension submitted' });
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
        {status === 'success' && <StatusPill $kind="pass"><CheckCircle size={12} /> Dimension wrote — {rows.length} distinct labels</StatusPill>}
        {(status === 'writing' || status === 'loading') && <StatusPill $kind="pending"><Loader size={12} className="spin" /> {status}…</StatusPill>}
        {status === 'error' && <StatusPill $kind="error">Failed</StatusPill>}
      </HeaderRow>

      {error && <ErrBox>{error}</ErrBox>}

      <Table>
        {rows.length === 0 ? (
          <Empty>{status === 'success' ? 'No rows returned — dim returned an empty list.' : 'Top-N preview will appear once the dim writes successfully.'}</Empty>
        ) : (
          rows.map((r) => (
            <Row key={r.label}>
              <span>{r.label}</span>
              <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{r.count}</span>
              <Bar $share={r.share} />
            </Row>
          ))
        )}
      </Table>

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
          Preview YAML fragment ({emit?.sectionKey})
        </summary>
        <Yaml>{emit?.fragment || '—'}</Yaml>
      </details>
    </Wrap>
  );
}
