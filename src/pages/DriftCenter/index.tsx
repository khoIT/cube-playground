/**
 * /drift-center — metric references that don't resolve against the active
 * workspace's live Cube schema, grouped by the underlying missing cube/measure,
 * for the ACTIVE game only (like /coverage?game=). Master–detail: a selectable
 * list of root causes (+ the detector log) on the left, a resolve pane on the
 * right. Repoint a stale ref or mark a metric N/A; resolving auto-advances to the
 * next group. Header recipe mirrors src/pages/Dashboards/index.tsx; all styling
 * via design tokens.
 */
import React from 'react';
import styled from 'styled-components';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { useWorkspaceContext } from '../../components/workspace-context';
import { useAuthUser } from '../../auth/auth-context';
import { useDriftCenter } from './use-drift-center';
import { RootCauseList, groupKey } from './root-cause-list';
import { DriftDetailPane } from './drift-detail-pane';
import { DetectorRunsPanel } from './detector-runs-panel';

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1200,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};
const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  marginBottom: 8,
};
const titleRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' };
const ledeStyle: React.CSSProperties = { margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)', maxWidth: '64ch' };
const refreshBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 12px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-pill)',
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-sans)',
  fontSize: 12.5,
  fontWeight: 500,
  cursor: 'pointer',
};
const roleTag: React.CSSProperties = {
  height: 22,
  padding: '0 9px',
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 'var(--radius-pill)',
  background: 'var(--bg-muted)',
  color: 'var(--text-muted)',
  fontSize: 11,
  fontWeight: 600,
};
const noteBase: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  padding: '12px 14px',
  borderRadius: 'var(--radius-md)',
  fontSize: 12.5,
  lineHeight: 1.5,
  marginTop: 16,
};
const summaryStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 14px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  margin: '18px 0 16px',
  fontSize: 12.5,
  color: 'var(--text-muted)',
};
const strong: React.CSSProperties = { fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' };

// Two-pane master–detail; collapses to a single column on narrow viewports.
const Grid = styled.div`
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 18px;
  align-items: start;
  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`;
const LeftPane = styled.div`
  position: sticky;
  top: 16px;
  align-self: start;
  max-height: calc(100vh - 32px);
  overflow: auto;
  @media (max-width: 860px) {
    position: static;
    max-height: none;
  }
`;
const Tabs = styled.div`
  display: flex;
  gap: 4px;
  margin: 18px 0 16px;
  border-bottom: 1px solid var(--border-card);
`;
const Tab = styled.button<{ $active: boolean }>`
  appearance: none;
  border: none;
  background: none;
  padding: 8px 14px;
  margin-bottom: -1px;
  border-bottom: 2px solid ${(p) => (p.$active ? 'var(--brand)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--text-primary)' : 'var(--text-muted)')};
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: ${(p) => (p.$active ? 600 : 500)};
  cursor: pointer;
  &:hover { color: var(--text-primary); }
`;

export function DriftCenterPage(): React.ReactElement {
  const gameId = useActiveGameId();
  const { workspaceId } = useWorkspaceContext();
  const user = useAuthUser();
  const canWrite = user ? user.role !== 'viewer' : true; // server enforces; this is UX-only
  const { report, loading, error, members, membersLoading, refetch, repoint, markNa } =
    useDriftCenter(gameId);

  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<'resolve' | 'runs'>('resolve');

  const groups = report?.groups ?? [];
  const affectedCount = React.useMemo(() => {
    const ids = new Set<string>();
    for (const g of groups) for (const id of g.affectedMetricIds) ids.add(id);
    return ids.size;
  }, [groups]);

  // Keep a valid selection: when the report changes (initial load or after a
  // resolve removes a group) snap to the still-present selection, else advance
  // to the first remaining group.
  React.useEffect(() => {
    if (groups.length === 0) {
      setSelectedKey(null);
      return;
    }
    setSelectedKey((prev) => (prev && groups.some((g) => groupKey(g) === prev) ? prev : groupKey(groups[0])));
  }, [groups]);

  const selectedGroup = groups.find((g) => groupKey(g) === selectedKey) ?? null;

  return (
    <div style={pageStyle}>
      <div style={eyebrowStyle}>
        Metrics{gameId ? ` · ${gameId}` : ''}{workspaceId ? ` · workspace: ${workspaceId}` : ''}
      </div>
      <div style={titleRow}>
        <AlertTriangle size={20} style={{ color: 'var(--brand)' }} aria-hidden />
        <h1 style={titleStyle}>Drift center</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {user ? <span style={roleTag}>{user.role}</span> : null}
          <button type="button" style={refreshBtn} onClick={() => void refetch()} disabled={loading}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>
      <p style={ledeStyle}>
        Metric references that don’t resolve against the active workspace’s live Cube schema, grouped
        by the underlying missing cube or measure. Repoint a stale reference or mark a metric
        not-applicable for this game.
      </p>

      {!gameId ? (
        <div style={{ ...noteBase, background: 'var(--bg-card)', border: '1px solid var(--border-card)', color: 'var(--text-secondary)' }}>
          Select a game to inspect drift.
        </div>
      ) : loading ? (
        <p style={{ ...ledeStyle, marginTop: 16 }}>Loading drift…</p>
      ) : error ? (
        <div style={{ ...noteBase, background: 'var(--destructive-soft)', color: 'var(--destructive-ink)' }}>
          Could not load drift: {error}
        </div>
      ) : report ? (
        <>
          <Tabs role="tablist">
            <Tab type="button" role="tab" aria-selected={tab === 'resolve'} $active={tab === 'resolve'} onClick={() => setTab('resolve')}>
              Resolve
            </Tab>
            <Tab type="button" role="tab" aria-selected={tab === 'runs'} $active={tab === 'runs'} onClick={() => setTab('runs')}>
              Detector runs
            </Tab>
          </Tabs>

          {tab === 'runs' ? (
            <DetectorRunsPanel gameId={gameId} canWrite={canWrite} />
          ) : report.prefixUnsupported ? (
            <div style={{ ...noteBase, background: 'var(--info-soft)', color: 'var(--info-ink)' }}>
              Drift isn’t meaningful for this workspace yet — cube names are prefixed and references
              aren’t translated. Full support lands in v1.5. (The detector still runs against local —
              see the Detector runs tab.)
            </div>
          ) : groups.length === 0 ? (
            <div style={{ ...noteBase, background: 'var(--success-soft)', color: 'var(--success-ink)' }}>
              All metrics resolve for {gameId}. Nothing to repoint. 🎉
            </div>
          ) : (
            <>
              <div style={summaryStyle}>
                <span style={strong}>{affectedCount}</span>
                <span>metric{affectedCount === 1 ? '' : 's'} affected across</span>
                <span style={strong}>{groups.length}</span>
                <span>root cause{groups.length === 1 ? '' : 's'}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                  reconciled {new Date(report.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <Grid>
                <LeftPane>
                  <RootCauseList groups={groups} selectedKey={selectedKey} onSelect={setSelectedKey} />
                </LeftPane>
                <DriftDetailPane
                  group={selectedGroup}
                  canWrite={canWrite}
                  members={members}
                  membersLoading={membersLoading}
                  onRepoint={repoint}
                  onMarkNa={markNa}
                />
              </Grid>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
