/**
 * Triage canvas orchestrator: owns the shared useOnboardingDraft engine + the
 * view preference, and renders exactly one of the three view renderers (A queue
 * / B graph / C chat) over that single state. The header (eyebrow, title,
 * progress, view switch, accept-all) lives here so each view stays a thin
 * renderer. Page-header recipe mirrors Dashboards/DriftCenter.
 */
import { ReactElement } from 'react';
import styled from 'styled-components';
import { Sparkles } from 'lucide-react';
import { useAuthUser } from '../../../auth/auth-context';
import { useOnboardingDraft } from '../use-onboarding-draft';
import { ViewSwitch, useTriageView } from './view-switch';
import { ViewBuilder } from './view-builder';
import { ViewQueue } from './view-queue';
import { ViewGraph } from './view-graph';
import { ViewChat } from './view-chat';

const Header = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
`;
const TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;
const Title = styled.h1`
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
`;
const Lede = styled.p`
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-muted);
  max-width: 64ch;
`;
const ProgressBar = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  margin: 0 0 16px;
  font-size: 12.5px;
  color: var(--text-secondary);
`;
const Track = styled.div`
  flex: 1;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--bg-muted);
  overflow: hidden;
`;
const Fill = styled.div<{ $pct: number }>`
  height: 100%;
  width: ${(p) => p.$pct}%;
  background: var(--brand);
`;
const AcceptAll = styled.button`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 500;
  padding: 7px 12px;
  cursor: pointer;
  &:hover {
    border-color: var(--brand);
    color: var(--brand);
  }
`;
const Pin = styled.span`
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
`;

interface Props {
  draftId: string;
}

export function TriageCanvas({ draftId }: Props): ReactElement {
  const user = useAuthUser();
  const canWrite = user ? user.role !== 'viewer' : true; // server enforces; UX-only
  const [view, setView] = useTriageView(user?.role);
  const state = useOnboardingDraft(draftId);

  const total = state.openCount + state.autoMappedCount + state.decisions.filter((d) => d.state !== 'open').length;
  const done = total - state.openCount;
  const progress = total > 0 ? Math.round((done / total) * 100) : 100;

  const subtitle = state.draft
    ? `${state.draft.source} start · ${state.draft.inference?.cubes.length ?? 0} cubes · ${total} fields profiled. Resolve the few ambiguous calls; the rest is auto-mapped.`
    : 'Loading draft…';

  return (
    <>
      <Header>
        <div style={{ flex: 1 }}>
          <TitleRow>
            <Sparkles size={20} style={{ color: 'var(--brand)' }} aria-hidden />
            <Title>Triage — {state.draft?.cubeName ?? 'draft model'}</Title>
          </TitleRow>
          <Lede>{subtitle}</Lede>
        </div>
        <ViewSwitch view={view} onChange={setView} />
      </Header>

      <ProgressBar>
        <span>📍</span>
        <Pin>{state.openCount}</Pin>
        <span>decision{state.openCount === 1 ? '' : 's'} left ·</span>
        <Pin>{state.autoMappedCount}</Pin>
        <span>auto-mapped</span>
        <Track aria-hidden>
          <Fill $pct={progress} />
        </Track>
        {canWrite ? (
          <AcceptAll type="button" onClick={state.acceptAllHighConfidence}>
            Accept all high-confidence
          </AcceptAll>
        ) : null}
      </ProgressBar>

      {state.loading ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading draft…</p>
      ) : state.error ? (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--destructive-soft)',
            color: 'var(--destructive-ink)',
            fontSize: 12.5,
          }}
        >
          Could not load draft: {state.error}
        </div>
      ) : view === 'graph' ? (
        <ViewGraph state={state} canWrite={canWrite} />
      ) : view === 'chat' ? (
        <ViewChat state={state} canWrite={canWrite} />
      ) : view === 'queue' ? (
        <ViewQueue state={state} canWrite={canWrite} />
      ) : (
        <ViewBuilder state={state} canWrite={canWrite} />
      )}
    </>
  );
}
