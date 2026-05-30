/**
 * /drift-center — metric references that don't resolve against the active
 * workspace's live Cube schema, grouped by the underlying missing cube/measure,
 * for the ACTIVE game only (like /coverage?game=). Repoint a stale ref or mark a
 * metric N/A. Header recipe mirrors src/pages/Dashboards/index.tsx; all styling
 * via design tokens (see plans/.../design/hifi-mockup.html — the design contract).
 */
import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useActiveGameId } from '../../components/Header/use-game-context';
import { useWorkspaceContext } from '../../components/workspace-context';
import { useAuthUser } from '../../auth/auth-context';
import { useDriftCenter } from './use-drift-center';
import { DriftGroupCard } from './drift-group-card';
import { DetectorRunPanel } from './detector-run-panel';

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1000,
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
const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--text-primary)',
};
const ledeStyle: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: 13,
  color: 'var(--text-muted)',
  maxWidth: '64ch',
};
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
const sectionH2: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  margin: '22px 0 12px',
};

export function DriftCenterPage(): React.ReactElement {
  const gameId = useActiveGameId();
  const { workspaceId } = useWorkspaceContext();
  const user = useAuthUser();
  const canWrite = user ? user.role !== 'viewer' : true; // server enforces; this is UX-only
  const { report, loading, error, members, membersLoading, refetch, repoint, markNa } =
    useDriftCenter(gameId);

  const affectedCount = React.useMemo(() => {
    if (!report) return 0;
    const ids = new Set<string>();
    for (const g of report.groups) for (const id of g.affectedMetricIds) ids.add(id);
    return ids.size;
  }, [report]);

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
      ) : report?.prefixUnsupported ? (
        <>
          <div style={{ ...noteBase, background: 'var(--info-soft)', color: 'var(--info-ink)' }}>
            Drift isn’t meaningful for this workspace yet — cube names are prefixed and references
            aren’t translated. Full support lands in v1.5.
          </div>
          {report ? <DetectorRunPanel panel={report.detectorPanel} /> : null}
        </>
      ) : report && report.groups.length === 0 ? (
        <>
          <div style={{ ...noteBase, background: 'var(--success-soft)', color: 'var(--success-ink)' }}>
            All metrics resolve for {gameId}. Nothing to repoint. 🎉
          </div>
          <DetectorRunPanel panel={report.detectorPanel} />
        </>
      ) : report ? (
        <>
          <div style={summaryStyle}>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {affectedCount}
            </span>
            <span>metric{affectedCount === 1 ? '' : 's'} affected across</span>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {report.groups.length}
            </span>
            <span>root cause{report.groups.length === 1 ? '' : 's'}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
              reconciled {new Date(report.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          <div style={sectionH2}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Root causes</h2>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {report.groups.length} group{report.groups.length === 1 ? '' : 's'} · {affectedCount} metrics affected
            </span>
          </div>

          {report.groups.map((g, i) => (
            <DriftGroupCard
              key={`${g.reason}:${g.key}`}
              group={g}
              canWrite={canWrite}
              members={members}
              membersLoading={membersLoading}
              onRepoint={repoint}
              onMarkNa={markNa}
              defaultOpen={i === 0}
            />
          ))}

          <DetectorRunPanel panel={report.detectorPanel} />
        </>
      ) : null}
    </div>
  );
}
