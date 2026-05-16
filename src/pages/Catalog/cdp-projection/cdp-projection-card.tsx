/**
 * CdpProjectionCard — renders the projected CDP `Metric` shape inside the
 * expanded measure row. For projectable measures it shows the payload preview
 * + Verify button + status badge; for non-projectable measures it renders a
 * disabled card with a reason and NO Verify button (button hidden, not
 * disabled — locked per plan Validation Session 1).
 */

import { useState } from 'react';
import styled from 'styled-components';
import type { CdpMetricPayload, ProjectionResult, VerifyState, VerifyDiffEntry } from './types';
import { useCdpVerify } from './use-cdp-verify';

const Card = styled.div<{ $disabled?: boolean }>`
  border: 1px solid var(--border-card);
  border-radius: 6px;
  padding: 10px 12px;
  background: var(--bg-panel, var(--bg-card));
  opacity: ${(p) => (p.$disabled ? 0.6 : 1)};
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: 130px 1fr;
  row-gap: 4px;
  column-gap: 8px;
  font-size: 11.5px;
`;

const Label = styled.span`
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 10px;
`;

const Value = styled.code`
  font-family: var(--font-mono);
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
`;

const ActionBar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
`;

const VerifyBtn = styled.button`
  appearance: none;
  cursor: pointer;
  background: var(--brand);
  color: var(--text-on-brand);
  border: 0;
  border-radius: var(--radius-pill);
  padding: 4px 12px;
  font-size: 11.5px;
  font-weight: 600;
  &:disabled { opacity: 0.5; cursor: progress; }
`;

const CopyBtn = styled.button`
  appearance: none;
  cursor: pointer;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-pill);
  padding: 4px 12px;
  font-size: 11.5px;
  font-weight: 600;
  &:hover { background: var(--pill-mono-bg); }
`;

const Badge = styled.span<{ $tone: 'gray' | 'green' | 'amber' | 'red' }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  background: ${(p) =>
    p.$tone === 'green' ? 'var(--success-soft, #d4edda)'
    : p.$tone === 'amber' ? 'var(--warning-soft, #fff3cd)'
    : p.$tone === 'red' ? 'var(--error-soft, #f8d7da)'
    : 'var(--pill-mono-bg)'};
  color: ${(p) =>
    p.$tone === 'green' ? 'var(--success, #1e7e34)'
    : p.$tone === 'amber' ? 'var(--warning, #856404)'
    : p.$tone === 'red' ? 'var(--error, #842029)'
    : 'var(--text-secondary)'};
`;

const DiffGrid = styled.div`
  display: grid;
  grid-template-columns: 110px 1fr 1fr;
  gap: 4px;
  margin-top: 4px;
  font-size: 11px;
`;

const DiffCell = styled.code<{ $tone?: 'expected' | 'actual' }>`
  font-family: var(--font-mono);
  padding: 2px 6px;
  border-radius: 3px;
  white-space: pre-wrap;
  word-break: break-word;
  background: ${(p) =>
    p.$tone === 'expected' ? 'var(--error-soft, #f8d7da)'
    : p.$tone === 'actual' ? 'var(--success-soft, #d4edda)'
    : 'transparent'};
  color: ${(p) =>
    p.$tone === 'expected' ? 'var(--error, #842029)'
    : p.$tone === 'actual' ? 'var(--success, #1e7e34)'
    : 'var(--text-primary)'};
`;

const Reason = styled.div`
  font-size: 12px;
  color: var(--text-secondary);
`;

const NOT_PROJECTABLE_LABEL: Record<string, string> = {
  'references-other-measures': 'references other measures',
  'not-single-source': 'not a single-source cube',
  'missing-cube-meta': 'cube has no CDP mapping',
  'unsupported-agg-type': 'unsupported aggregation type',
};

interface CdpProjectionCardProps {
  projection: ProjectionResult;
}

export function CdpProjectionCard({ projection }: CdpProjectionCardProps) {
  if (!projection.ok) {
    return (
      <Card $disabled data-testid="cdp-card-not-projectable">
        <Label>Not projectable</Label>
        <Reason>Reason: {NOT_PROJECTABLE_LABEL[projection.reason] ?? projection.reason}</Reason>
      </Card>
    );
  }

  return <ProjectableCard payload={projection.payload} />;
}

function ProjectableCard({ payload }: { payload: CdpMetricPayload }) {
  const { state, check } = useCdpVerify(payload);
  const [copied, setCopied] = useState(false);

  async function copyJson() {
    const json = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = json;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card data-testid="cdp-card">
      <FieldGrid>
        <Label>game_id</Label><Value>{payload.game_id}</Value>
        <Label>metric_name</Label><Value>{payload.metric_name}</Value>
        <Label>metric_codename</Label><Value>{payload.metric_codename}</Value>
        <Label>source</Label><Value>{payload.source}</Value>
        <Label>expression</Label><Value>{payload.expression}</Value>
        <Label>dimensions</Label><Value>{payload.dimensions.join(', ') || '(none)'}</Value>
        <Label>filter</Label><Value>{payload.filter || '(empty)'}</Value>
      </FieldGrid>
      <ActionBar>
        <VerifyBtn type="button" onClick={check} disabled={state.kind === 'checking'}>
          {state.kind === 'error' ? 'Retry' : 'Verify on CDP'}
        </VerifyBtn>
        <CopyBtn type="button" onClick={copyJson} data-testid="copy-json">
          {copied ? 'Copied!' : 'Copy JSON'}
        </CopyBtn>
        <StatusBadge state={state} />
      </ActionBar>
      {state.kind === 'mismatch' && <DiffList diff={state.diff} />}
    </Card>
  );
}

function StatusBadge({ state }: { state: VerifyState }) {
  switch (state.kind) {
    case 'idle': return <Badge $tone="gray" data-testid="badge-idle">Not checked</Badge>;
    case 'checking': return <Badge $tone="gray" data-testid="badge-checking">Checking…</Badge>;
    case 'available': return <Badge $tone="green" data-testid="badge-available">Available</Badge>;
    case 'missing': return <Badge $tone="amber" data-testid="badge-missing">Missing</Badge>;
    case 'mismatch': return <Badge $tone="red" data-testid="badge-mismatch">Mismatch</Badge>;
    case 'error': return <Badge $tone="red" data-testid="badge-error">Error: {state.message}</Badge>;
  }
}

function DiffList({ diff }: { diff: VerifyDiffEntry[] }) {
  return (
    <DiffGrid data-testid="diff-list">
      <Label>Field</Label>
      <Label>Expected</Label>
      <Label>Actual</Label>
      {diff.map((d) => (
        <DiffRow key={d.field} entry={d} />
      ))}
    </DiffGrid>
  );
}

function DiffRow({ entry }: { entry: VerifyDiffEntry }) {
  return (
    <>
      <DiffCell>{entry.field}</DiffCell>
      <DiffCell $tone="expected" className="diff-expected">{formatValue(entry.expected)}</DiffCell>
      <DiffCell $tone="actual" className="diff-actual">{formatValue(entry.actual)}</DiffCell>
    </>
  );
}

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  if (v == null || v === '') return '(empty)';
  return String(v);
}
