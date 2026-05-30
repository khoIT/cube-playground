/**
 * Small shared presentation primitives for the three triage views: the live
 * YAML preview pane, a confidence pill, and the validate/stage action bar.
 * Kept here so each view stays a thin renderer over the shared hook and DRY
 * across A/B/C. All tokens; the YAML pane uses the mono font on a muted panel.
 */
import { ReactElement, ReactNode } from 'react';
import styled from 'styled-components';
import type { ValidateResponse } from '../../../api/onboarding-client';
import type { Decision } from '../use-onboarding-draft';

/** Shared formatting of a validate result → ({ label, ok }) for all 3 views. */
export function summariseValidation(v: ValidateResponse | null): { label: string | null; ok: boolean } {
  if (!v) return { label: null, ok: true };
  const live = v.live;
  if (live == null) {
    return { label: `Structural: ${v.structural.ok ? 'ok' : 'failed'}`, ok: v.structural.ok };
  }
  if (live.ok === true) {
    return { label: `Live query ok · ${live.rowCount.toLocaleString()} rows`, ok: v.structural.ok };
  }
  return { label: `Live query failed: ${live.error}`, ok: false };
}

export const ConfidencePill = styled.span<{ $low: boolean }>`
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  background: ${(p) => (p.$low ? 'var(--warning-soft)' : 'var(--success-soft)')};
  color: ${(p) => (p.$low ? 'var(--warning-ink)' : 'var(--success-ink)')};
`;

export function pct(conf: number): string {
  return `${Math.round(conf * 100)}%`;
}

const Pane = styled.section`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;
const PaneHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-card);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
`;
const Code = styled.pre`
  margin: 0;
  flex: 1;
  overflow: auto;
  padding: 16px;
  background: var(--bg-muted);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-primary);
  white-space: pre;
`;

interface YamlPaneProps {
  yaml: string;
  fileName?: string;
  /** Footer slot for the validate/stage bar. */
  footer?: ReactNode;
}

export function YamlPane({ yaml, fileName = 'model.yml', footer }: YamlPaneProps): ReactElement {
  return (
    <Pane>
      <PaneHead>
        <span>Live model preview</span>
        <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 500, color: 'var(--text-muted)' }}>
          {fileName}
        </span>
      </PaneHead>
      <Code aria-label="Generated cube YAML">{yaml || '# Generating draft…'}</Code>
      {footer}
    </Pane>
  );
}

// ── Validate + Stage action bar (shared by all views) ───────────────────────
const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-card);
`;
const ValidateBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--success-soft);
  color: var(--success-ink);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 14px;
  cursor: pointer;
  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;
const StageBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  background: var(--brand);
  color: var(--text-on-brand, #fff);
  border: none;
  border-radius: var(--radius-sm);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  cursor: pointer;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
const ValidateNote = styled.span<{ $ok: boolean }>`
  font-size: 12px;
  color: ${(p) => (p.$ok ? 'var(--success-ink)' : 'var(--destructive-ink)')};
`;

interface ActionBarProps {
  canWrite: boolean;
  validating: boolean;
  validationLabel: string | null;
  validationOk: boolean;
  staging: boolean;
  staged: boolean;
  openCount: number;
  onValidate: () => void;
  onStage: () => void;
}

export function TriageActionBar({
  canWrite,
  validating,
  validationLabel,
  validationOk,
  staging,
  staged,
  openCount,
  onValidate,
  onStage,
}: ActionBarProps): ReactElement {
  return (
    <Bar>
      <ValidateBtn type="button" onClick={onValidate} disabled={validating || !canWrite}>
        {validating ? 'Validating…' : 'Validate (real query)'}
      </ValidateBtn>
      {validationLabel ? <ValidateNote $ok={validationOk}>{validationLabel}</ValidateNote> : null}
      {canWrite ? (
        <StageBtn
          type="button"
          onClick={onStage}
          disabled={staging || staged || openCount > 0}
          title={openCount > 0 ? `Resolve ${openCount} open decision${openCount === 1 ? '' : 's'} first` : undefined}
        >
          {staged ? 'Staged ✓' : staging ? 'Staging…' : 'Stage for approval →'}
        </StageBtn>
      ) : null}
    </Bar>
  );
}

export function rationaleTitle(d: Decision): string {
  return `${pct(d.confidence)} confident · ${d.rationale}`;
}
