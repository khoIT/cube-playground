/**
 * Per-metric "mark N/A" toggle for the active game. Marking N/A excludes the
 * metric from drift for this game across all workspaces (applicability is a
 * registry property). Hidden for viewers (server enforces the gate too).
 */
import { ReactElement, useState } from 'react';
import styled from 'styled-components';

const Toggle = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 18px;
  padding: 0 7px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: 500;
  cursor: pointer;
  &:hover:not(:disabled) { color: var(--text-secondary); border-color: var(--text-secondary); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

interface Props {
  metricId: string;
  onMarkNa: (metricId: string, applicable: boolean) => Promise<void>;
}

export function MarkNaToggle({ metricId, onMarkNa }: Props): ReactElement {
  const [busy, setBusy] = useState(false);
  return (
    <Toggle
      type="button"
      disabled={busy}
      title={`Mark "${metricId}" not applicable for this game`}
      onClick={async () => {
        setBusy(true);
        try {
          await onMarkNa(metricId, false);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? 'marking…' : 'mark N/A'}
    </Toggle>
  );
}
