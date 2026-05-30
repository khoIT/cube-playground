/**
 * "Detector runs" tab — the live monitoring surface for the background drift
 * reconciliation: schedule (interval · last · next), a sparkline of unresolved
 * counts, and a table of the last N runs with new/resolved deltas + by-reason
 * split. "Run now" triggers a reconciliation on demand; the panel also live-polls
 * (see useDriftRuns). All styling via design tokens.
 */
import { ReactElement } from 'react';
import styled from 'styled-components';
import { RefreshCw, Play } from 'lucide-react';
import { useDriftRuns, type DriftRun } from './use-drift-runs';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;
const Schedule = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  font-size: 12.5px;
  color: var(--text-secondary);
`;
const Dot = styled.span`
  color: var(--text-muted);
`;
const Strong = styled.span`
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
`;
const RunBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  height: 30px;
  padding: 0 14px;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--brand);
  color: var(--text-on-brand);
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  &:hover:not(:disabled) { background: var(--brand-hover); }
  &:disabled { opacity: 0.55; cursor: not-allowed; }
`;

const Spark = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 56px;
  padding: 12px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
`;
const Bar = styled.div<{ $h: number; $latest: boolean }>`
  flex: 1;
  min-width: 6px;
  height: ${(p) => Math.max(4, p.$h)}%;
  border-radius: var(--radius-xs) var(--radius-xs) 0 0;
  background: ${(p) => (p.$latest ? 'var(--brand)' : 'var(--info-soft)')};
`;

const Table = styled.div`
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--bg-card);
`;
const HeadRow = styled.div`
  display: grid;
  grid-template-columns: 1.4fr 0.9fr 0.7fr 0.7fr 1.4fr 0.7fr;
  gap: 10px;
  padding: 9px 14px;
  background: var(--bg-muted);
  border-bottom: 1px solid var(--border-card);
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
`;
const DataRow = styled.div`
  display: grid;
  grid-template-columns: 1.4fr 0.9fr 0.7fr 0.7fr 1.4fr 0.7fr;
  gap: 10px;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-card);
  font-size: 12.5px;
  color: var(--text-secondary);
  &:last-child { border-bottom: none; }
  font-variant-numeric: tabular-nums;
`;
const TimeCell = styled.div`
  display: flex;
  flex-direction: column;
  & b { font-weight: 600; color: var(--text-primary); }
  & small { font-size: 11px; color: var(--text-muted); }
`;
const Delta = styled.span<{ $kind: 'new' | 'resolved' | 'zero' }>`
  font-weight: 600;
  color: ${(p) =>
    p.$kind === 'new' ? 'var(--destructive-ink)'
    : p.$kind === 'resolved' ? 'var(--success-ink)'
    : 'var(--text-muted)'};
`;
const Reasons = styled.div`
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
`;
const StatusPill = styled.span<{ $status: 'ok' | 'skipped' | 'error' }>`
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: var(--radius-pill);
  font-size: 10.5px;
  font-weight: 600;
  background: ${(p) =>
    p.$status === 'ok' ? 'var(--success-soft)'
    : p.$status === 'error' ? 'var(--destructive-soft)'
    : 'var(--muted-soft)'};
  color: ${(p) =>
    p.$status === 'ok' ? 'var(--success-ink)'
    : p.$status === 'error' ? 'var(--destructive-ink)'
    : 'var(--muted-ink)'};
`;
const Note = styled.p`
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
`;
const Empty = styled.div`
  padding: 28px 14px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-lg);
`;

function fmtInterval(ms: number): string {
  const h = ms / 3_600_000;
  if (h >= 1) return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
  const m = Math.round(ms / 60_000);
  return `${m}m`;
}
function fmtClock(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtRel(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function DeltaCell({ n, kind }: { n: number; kind: 'new' | 'resolved' }): ReactElement {
  if (n === 0) return <Delta $kind="zero">—</Delta>;
  return <Delta $kind={kind}>{kind === 'new' ? `+${n}` : `−${n}`}</Delta>;
}

interface Props {
  gameId: string | null;
  canWrite: boolean;
}

export function DetectorRunsPanel({ gameId, canWrite }: Props): ReactElement {
  const { report, loading, error, running, refetch, runNow } = useDriftRuns(gameId);

  const runs = report?.runs ?? [];
  const max = runs.reduce((m, r) => Math.max(m, r.totalUnresolved), 1);
  // Sparkline chronological (oldest → newest); table newest-first.
  const chrono = [...runs].reverse();

  return (
    <Wrap>
      <Schedule>
        <span>Detector runs every <Strong>{report ? fmtInterval(report.intervalMs) : '—'}</Strong></span>
        <Dot>·</Dot>
        <span>last <Strong>{fmtClock(report?.lastRunAt ?? null)}</Strong></span>
        <Dot>·</Dot>
        <span>next ~<Strong>{fmtClock(report?.nextRunAt ?? null)}</Strong></span>
        {canWrite ? (
          <RunBtn type="button" onClick={() => void runNow()} disabled={running || !gameId}>
            {running ? <RefreshCw size={13} /> : <Play size={13} />}
            {running ? 'Running…' : 'Run now'}
          </RunBtn>
        ) : (
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={loading}
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 14px', background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-pill)', color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}
          >
            <RefreshCw size={13} /> Refresh
          </button>
        )}
      </Schedule>

      {error ? <Note style={{ color: 'var(--destructive-ink)' }}>Could not load runs: {error}</Note> : null}

      {loading && runs.length === 0 ? (
        <Note>Loading run history…</Note>
      ) : runs.length === 0 ? (
        <Empty>No detector runs recorded yet for this game. Trigger one with “Run now”.</Empty>
      ) : (
        <>
          <Spark>
            {chrono.map((r, i) => (
              <Bar
                key={r.id}
                $h={(r.totalUnresolved / max) * 100}
                $latest={i === chrono.length - 1}
                title={`${fmtClock(r.startedAt)} · ${r.totalUnresolved} unresolved`}
              />
            ))}
          </Spark>

          <Table>
            <HeadRow>
              <div>Time</div>
              <div>Unresolved</div>
              <div>New</div>
              <div>Resolved</div>
              <div>Reasons</div>
              <div>Status</div>
            </HeadRow>
            {runs.map((r: DriftRun) => (
              <DataRow key={r.id}>
                <TimeCell>
                  <b>{fmtClock(r.startedAt)}</b>
                  <small>{fmtRel(r.startedAt)}{r.source === 'manual' ? ' · manual' : ''}</small>
                </TimeCell>
                <div>
                  <Strong>{r.totalUnresolved}</Strong>{' '}
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>· {r.rootCauseCount} groups</span>
                </div>
                <div><DeltaCell n={r.newCount} kind="new" /></div>
                <div><DeltaCell n={r.resolvedCount} kind="resolved" /></div>
                <Reasons>
                  <span title="cube-missing">cm {r.cubeMissing}</span>
                  <span title="member-missing">mm {r.memberMissing}</span>
                  <span title="unparseable">u {r.unparseable}</span>
                </Reasons>
                <div><StatusPill $status={r.status}>{r.status}</StatusPill></div>
              </DataRow>
            ))}
          </Table>
        </>
      )}
    </Wrap>
  );
}
