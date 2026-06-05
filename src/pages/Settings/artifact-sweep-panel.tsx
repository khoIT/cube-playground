/**
 * Settings → Artifact sweep panel.
 * On-demand validation of saved artifacts against the workspace's live /meta.
 * Renders a "Validate artifacts" button + optional live-probe checkbox,
 * then a summary chip row and a collapsible list of failing artifacts.
 *
 * Disabled entirely for non-game_id workspaces (sweep not applicable).
 */

import { ReactElement, useState } from 'react';
import styled from 'styled-components';
import { ShieldCheck } from 'lucide-react';

import {
  SectionCard,
  SectionHead,
  SectionTitle,
  SectionHint,
} from './section-card';
import {
  useArtifactSweep,
  type ArtifactResult,
  type ArtifactStatus,
} from './use-artifact-sweep';

// ---------------------------------------------------------------------------
// Styled primitives — tokens only, parity with workspace-readiness-section
// ---------------------------------------------------------------------------

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
`;

const RunBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  &:hover:not(:disabled) {
    color: var(--brand);
    border-color: var(--brand);
    background: var(--brand-soft);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const LiveLabel = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-secondary);
  font-family: var(--font-sans);
  cursor: pointer;
  user-select: none;
`;

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
`;

const Chip = styled.span<{ tone: 'ok' | 'warn' | 'bad' | 'mute' | 'neutral' }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 500;
  font-family: var(--font-sans);
  background: ${(p) =>
    p.tone === 'ok'
      ? 'var(--success-soft)'
      : p.tone === 'warn'
      ? 'var(--warning-soft)'
      : p.tone === 'bad'
      ? 'var(--destructive-soft)'
      : p.tone === 'mute'
      ? 'var(--muted-soft)'
      : 'var(--bg-muted)'};
  color: ${(p) =>
    p.tone === 'ok'
      ? 'var(--success-ink)'
      : p.tone === 'warn'
      ? 'var(--warning-ink)'
      : p.tone === 'bad'
      ? 'var(--destructive-ink)'
      : p.tone === 'mute'
      ? 'var(--muted-ink)'
      : 'var(--text-secondary)'};
`;

const FailureList = styled.div`
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const FailureRow = styled.div`
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  background: var(--destructive-soft);
  color: var(--destructive-ink);

  & .label {
    font-size: 12.5px;
    font-weight: 600;
    margin-bottom: 2px;
  }
  & .sub {
    font-size: 11.5px;
    opacity: 0.85;
    word-break: break-all;
  }
`;

const UnverifiedRow = styled(FailureRow)`
  background: var(--muted-soft);
  color: var(--muted-ink);
`;

const CollapseToggle = styled.button`
  margin-top: 10px;
  background: none;
  border: none;
  color: var(--brand);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  padding: 0;
  &:hover {
    text-decoration: underline;
  }
`;

const Empty = styled.div`
  font-size: 12.5px;
  color: var(--text-muted);
  padding: 14px 0 0;
`;

const NoteText = styled.p`
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
`;

const ErrorBanner = styled.div`
  margin-top: 12px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  background: var(--destructive-soft);
  color: var(--destructive-ink);
  font-size: 12.5px;
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_VISIBLE = 50;

function statusLabel(s: ArtifactStatus): string {
  switch (s) {
    case 'ok': return 'ok';
    case 'unverified': return 'unverified';
    case 'missing-member': return 'missing member';
    case 'missing-preagg': return 'missing pre-agg';
    case 'runtime-error': return 'runtime error';
  }
}

function kindLabel(k: ArtifactResult['kind']): string {
  return k === 'chat' ? 'chat' : k === 'dashboard' ? 'dashboard' : 'segment';
}

/** Failing = anything that isn't 'ok'. Unverified gets muted row, others get destructive. */
function isFailure(s: ArtifactStatus): boolean {
  return s !== 'ok';
}

function ArtifactFailureItem({ item }: { item: ArtifactResult }): ReactElement {
  const sub = item.refs?.join(', ') ?? item.detail ?? '';
  const Row = item.status === 'unverified' ? UnverifiedRow : FailureRow;
  return (
    <Row>
      <div className="label">
        {kindLabel(item.kind)} · {item.title} — {statusLabel(item.status)}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ArtifactSweepPanelProps {
  workspaceId: string | null;
  gameModel: 'game_id' | 'prefix' | string | undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ArtifactSweepPanel({
  workspaceId,
  gameModel,
}: ArtifactSweepPanelProps): ReactElement {
  const [liveProbe, setLiveProbe] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { result, running, error, run } = useArtifactSweep(workspaceId);

  const isGameId = gameModel === 'game_id';
  const disabled = !isGameId || running || !workspaceId;

  function handleRun(): void {
    void run(liveProbe);
    setCollapsed(false);
  }

  const allFailures: ArtifactResult[] = result
    ? [
        ...result.dashboards,
        ...result.segments,
        ...result.chatArtifacts,
      ].filter((a) => isFailure(a.status))
    : [];

  const visibleFailures = allFailures.slice(0, MAX_VISIBLE);
  const overflowCount = allFailures.length - visibleFailures.length;

  return (
    <SectionCard>
      <SectionHead>
        <div>
          <SectionTitle>Artifact validation</SectionTitle>
          <SectionHint>
            {isGameId
              ? 'Validate saved dashboards, segments, and chat artifacts against the current workspace /meta. Live probes (chat artifacts only) issue a bounded query to detect missing pre-aggregations.'
              : 'Artifact sweep only applies to game_id workspaces.'}
          </SectionHint>
        </div>
      </SectionHead>

      <Toolbar>
        <RunBtn
          type="button"
          disabled={disabled}
          onClick={handleRun}
          data-testid="validate-artifacts-btn"
        >
          <ShieldCheck size={13} strokeWidth={2} />
          {running ? 'Validating…' : 'Validate artifacts'}
        </RunBtn>

        <LiveLabel>
          <input
            type="checkbox"
            checked={liveProbe}
            disabled={!isGameId || !workspaceId}
            onChange={(e) => setLiveProbe(e.target.checked)}
            data-testid="live-probe-checkbox"
          />
          Run live probes (chat artifacts)
        </LiveLabel>
      </Toolbar>

      {!isGameId && (
        <Empty data-testid="na-hint">
          n/a — artifact sweep is only available for game_id workspaces
        </Empty>
      )}

      {error && (
        <ErrorBanner data-testid="sweep-error">{error}</ErrorBanner>
      )}

      {result && (
        <>
          <ChipRow data-testid="summary-chips">
            <Chip tone="neutral">{result.summary.total} total</Chip>
            <Chip tone="ok">{result.summary.ok} ok</Chip>
            {result.summary.unverified > 0 && (
              <Chip tone="mute">{result.summary.unverified} unverified</Chip>
            )}
            {result.summary.missingMember > 0 && (
              <Chip tone="bad">{result.summary.missingMember} missing member</Chip>
            )}
            {result.summary.missingPreagg > 0 && (
              <Chip tone="warn">{result.summary.missingPreagg} missing pre-agg</Chip>
            )}
            {result.summary.runtimeError > 0 && (
              <Chip tone="bad">{result.summary.runtimeError} runtime error</Chip>
            )}
          </ChipRow>

          {result.note && <NoteText data-testid="sweep-note">{result.note}</NoteText>}

          {allFailures.length === 0 && (
            <Empty data-testid="all-ok-msg">All artifacts look healthy.</Empty>
          )}

          {allFailures.length > 0 && (
            <>
              <CollapseToggle
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                data-testid="collapse-toggle"
              >
                {collapsed
                  ? `Show ${allFailures.length} issue${allFailures.length !== 1 ? 's' : ''}`
                  : `Hide ${allFailures.length} issue${allFailures.length !== 1 ? 's' : ''}`}
              </CollapseToggle>

              {!collapsed && (
                <FailureList data-testid="failure-list">
                  {visibleFailures.map((item) => (
                    <ArtifactFailureItem key={`${item.kind}-${item.id}`} item={item} />
                  ))}
                  {overflowCount > 0 && (
                    <Empty>+{overflowCount} more not shown</Empty>
                  )}
                </FailureList>
              )}
            </>
          )}
        </>
      )}
    </SectionCard>
  );
}

export default ArtifactSweepPanel;
