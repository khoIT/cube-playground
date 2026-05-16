import { useMemo, useState } from 'react';
import styled from 'styled-components';
import { notification } from 'antd';
import { Play, Loader, CheckCircle } from 'lucide-react';
import { useHistory } from 'react-router-dom';
import type { NewMetricDraftV2 } from '../../../types';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import { generateV2 } from '../../../yaml/generate-measure-yaml';
import { postSchemaWrite, deleteSchemaWrite } from '../../../api';

const HeroCard = styled.div`
  background: var(--bg-muted);
  border: 1px dashed var(--border-card);
  border-radius: 14px;
  padding: 32px;
  text-align: center;
`;
const HeroTitle = styled.div`
  font-size: 18px;
  font-weight: 600;
  margin-top: 12px;
  color: var(--text-primary);
`;
const HeroSub = styled.div`
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 4px;
`;
const Primary = styled.button`
  margin-top: 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--brand);
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  &:hover { background: var(--brand-hover); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const StatusGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 16px;
`;
const StatusCard = styled.div`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 12px;
  padding: 14px;
`;
const StatusLabel = styled.div`
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
`;
const StatusValue = styled.div`
  font-size: 20px;
  font-weight: 700;
  margin-top: 4px;
  color: var(--text-primary);
`;

type Status = 'idle' | 'submitting' | 'committed' | 'error';

export type TestRunBodyProps = {
  draft: NewMetricDraftV2;
  sourceCube: WizardCube | null;
  onSubmitted: (info: { cubeName: string; measureName: string }) => void;
};

export function TestRunBody({ draft, sourceCube, onSubmitted }: TestRunBodyProps) {
  const history = useHistory();
  const [status, setStatus] = useState<Status>('idle');
  const [warning, setWarning] = useState<string | null>(null);

  const yamlFragment = useMemo(() => {
    if (!draft.sourceCube) return '';
    try {
      const { fragment } = generateV2(draft, {
        sourceCube: draft.sourceCube,
        reachableMembers: [],
        peerMeasureNames: (sourceCube?.measures ?? []).map((m) => m.name.split('.').slice(-1)[0]),
      });
      return fragment;
    } catch {
      return '';
    }
  }, [draft, sourceCube]);

  async function handleSubmit() {
    if (!draft.sourceCube || !draft.name || !yamlFragment) {
      notification.error({ message: 'Missing required fields' });
      return;
    }
    setStatus('submitting');
    setWarning(null);
    const cubeName = draft.sourceCube;
    const measureName = draft.name;
    const result = await postSchemaWrite({ cubeName, measureName, yamlPatch: yamlFragment });

    if (result.ok && result.warning === 'meta-not-acknowledged') {
      // Hot-reload timeout — auto-discard to restore .bak.
      await deleteSchemaWrite({ cubeName, measureName });
      notification.warning({
        message: 'Cube hot-reload timed out',
        description: 'Changes were rolled back. Re-run when the cube is responsive.',
      });
      setStatus('error');
      setWarning('meta-not-acknowledged');
      return;
    }

    if (!result.ok) {
      const status = 'status' in result ? result.status : 'unknown';
      const reason = 'reason' in result ? result.reason : 'unknown';
      notification.error({
        message: 'Submit failed',
        description: `${status}: ${reason}`,
      });
      setStatus('error');
      return;
    }

    setStatus('committed');
    onSubmitted({ cubeName, measureName });
    notification.success({ message: 'Metric submitted' });
    // Navigate to success page (RR5 + URL query fallback for hard reload).
    history.push(
      `/metrics/new/success?name=${encodeURIComponent(measureName)}&cubeName=${encodeURIComponent(cubeName)}`
    );
  }

  if (status === 'idle' || status === 'error') {
    return (
      <>
        <HeroCard>
          <Play size={48} color="var(--brand)" />
          <HeroTitle>Ready when you are</HeroTitle>
          <HeroSub>
            Submit will commit <code style={{ fontFamily: 'var(--font-mono)' }}>{draft.name || '—'}</code>{' '}
            to <code style={{ fontFamily: 'var(--font-mono)' }}>{draft.sourceCube || '—'}</code> and reload Cube.
          </HeroSub>
          <Primary onClick={handleSubmit} disabled={!draft.name || !draft.sourceCube || !yamlFragment}>
            <Play size={14} /> Submit metric request
          </Primary>
          {warning && (
            <div style={{ marginTop: 12, color: 'var(--warning)', fontSize: 12.5 }}>
              Previous run rolled back ({warning}). Re-run to retry.
            </div>
          )}
        </HeroCard>
        {yamlFragment && (
          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
              Preview YAML fragment
            </summary>
            <pre style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--bg-muted)',
              padding: 12, borderRadius: 10, marginTop: 8, whiteSpace: 'pre-wrap',
            }}>{yamlFragment}</pre>
          </details>
        )}
      </>
    );
  }

  if (status === 'submitting') {
    return (
      <HeroCard>
        <Loader size={48} color="var(--brand)" className="spin" />
        <HeroTitle>Committing…</HeroTitle>
        <HeroSub>Writing YAML and waiting for Cube to acknowledge.</HeroSub>
      </HeroCard>
    );
  }

  // committed
  return (
    <>
      <HeroCard>
        <CheckCircle size={48} color="var(--success)" />
        <HeroTitle>Metric committed</HeroTitle>
        <HeroSub>Cube reloaded and acknowledged the new measure.</HeroSub>
      </HeroCard>
      <StatusGrid>
        <StatusCard>
          <StatusLabel>Status</StatusLabel>
          <StatusValue style={{ color: 'var(--success)' }}>OK</StatusValue>
        </StatusCard>
        <StatusCard>
          <StatusLabel>Measure</StatusLabel>
          <StatusValue style={{ fontSize: 14, fontFamily: 'var(--font-mono)' }}>{draft.name}</StatusValue>
        </StatusCard>
        <StatusCard>
          <StatusLabel>Cube</StatusLabel>
          <StatusValue style={{ fontSize: 14, fontFamily: 'var(--font-mono)' }}>{draft.sourceCube}</StatusValue>
        </StatusCard>
      </StatusGrid>
    </>
  );
}
