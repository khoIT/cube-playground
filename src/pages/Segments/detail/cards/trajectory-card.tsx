/**
 * TrajectoryCard — cohort size + entered/exited from the lakehouse membership
 * snapshot (GET /api/segments/:id/trajectory). Design: user-picked mix of the
 * stacked-panels chart (size line over a diverging delta strip, shared x-axis)
 * with a quotable stat rail on the left. Gap days (missed nightly snapshots)
 * render as amber markers, never interpolated — interpolating a gap would
 * fabricate membership.
 *
 * Supersedes the SQLite refresh-log sparkline for snapshot-covered segments;
 * does NOT replace it (segments without snapshots keep the legacy path).
 */

import { ReactElement, useEffect, useState } from 'react';
import { Waypoints } from 'lucide-react';
import { apiFetch } from '../../../../api/api-client';
import { CardShell } from './card-shell';
import {
  buildTrajectoryModel,
  fmtCompact,
  fmtPct,
  type TrajectoryModel,
  type TrajectoryPayload,
} from './trajectory-card-model';
import type { Segment } from '../../../../types/segment-api';

const W = 640;
const LINE_H = 120;
const STRIP_H = 72;
const PAD_X = 10;

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }): ReactElement {
  const color = tone === 'positive' ? 'var(--positive)' : tone === 'negative' ? 'var(--negative)' : 'var(--text-primary)';
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2, color }}>{value}</div>
    </div>
  );
}

function Chip({ children, tone }: { children: string; tone: 'success' | 'warning' }): ReactElement {
  const map = {
    success: { bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
    warning: { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
  } as const;
  return (
    <span style={{ background: map[tone].bg, color: map[tone].ink, borderRadius: 'var(--radius-full)', padding: '2px 8px', fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function TrajectoryCharts({ m }: { m: TrajectoryModel }): ReactElement {
  const n = m.days.length;
  const x = (i: number) => (n === 1 ? W / 2 : PAD_X + (i * (W - 2 * PAD_X)) / (n - 1));
  const span = Math.max(1, m.maxMembers - m.minMembers);
  const y = (members: number) => 10 + (1 - (members - m.minMembers) / span) * (LINE_H - 24);

  let linePath = '';
  const gapRects: ReactElement[] = [];
  const dots: ReactElement[] = [];
  const bars: ReactElement[] = [];
  const mid = STRIP_H / 2 - 6;
  const barW = Math.max(2, Math.min(7, (W - 2 * PAD_X) / Math.max(1, n) - 2));

  // Pen lifts across gap days — drawing an L through the amber band would
  // interpolate membership we never observed.
  let penDown = false;
  m.days.forEach((d, i) => {
    const cx = x(i);
    if (d.members == null) {
      gapRects.push(
        <rect key={`g${d.date}`} x={cx - barW / 2} y={6} width={barW} height={LINE_H - 16} fill="var(--warning-soft)" />,
      );
      penDown = false;
      return;
    }
    linePath += `${penDown ? ' L' : `${linePath ? ' ' : ''}M`}${cx.toFixed(1)} ${y(d.members).toFixed(1)}`;
    penDown = true;
    if (n <= 21) {
      dots.push(<circle key={`d${d.date}`} cx={cx} cy={y(d.members)} r={2.5} fill="var(--brand)" />);
    }
    if (d.entered != null || d.exited != null) {
      const eh = ((d.entered ?? 0) / m.maxDelta) * (mid - 6);
      const xh = ((d.exited ?? 0) / m.maxDelta) * (mid - 6);
      bars.push(
        <g key={`b${d.date}`}>
          <rect x={cx - barW / 2} y={mid - eh} width={barW} height={eh} fill="var(--positive)" opacity={0.6} />
          <rect x={cx - barW / 2} y={mid + 1} width={barW} height={xh} fill="var(--negative)" opacity={0.6} />
        </g>,
      );
    }
  });

  const tickIdx = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : n === 2 ? [0, 1] : [0];
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <svg viewBox={`0 0 ${W} ${LINE_H}`} style={{ width: '100%', display: 'block' }} role="img" aria-label="Cohort size over time">
        {gapRects}
        <path d={linePath} fill="none" stroke="var(--brand)" strokeWidth={2} />
        {dots}
        <text x={4} y={14} fontSize={10} fill="var(--text-muted)">{fmtCompact(m.maxMembers)}</text>
        <text x={4} y={LINE_H - 6} fontSize={10} fill="var(--text-muted)">{fmtCompact(m.minMembers)}</text>
      </svg>
      <svg viewBox={`0 0 ${W} ${STRIP_H}`} style={{ width: '100%', display: 'block' }} role="img" aria-label="Members entered and exited per day">
        <line x1={PAD_X} x2={W - PAD_X} y1={mid} y2={mid} stroke="var(--border-card)" />
        {bars}
        {tickIdx.map((i) => (
          <text key={i} x={x(i)} y={STRIP_H - 2} fontSize={10} fill="var(--text-muted)" textAnchor="middle">
            {m.days[i].date.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}

interface Props {
  segment: Segment;
}

export function TrajectoryCard({ segment }: Props): ReactElement | null {
  const [payload, setPayload] = useState<TrajectoryPayload | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch<TrajectoryPayload>(`/api/segments/${encodeURIComponent(segment.id)}/trajectory?days=90`)
      .then((d) => { if (alive) { setPayload(d); setError(null); } })
      .catch((err: Error) => { if (alive) setError(err); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [segment.id]);

  // Mount-guard lives here too (server 404s non-predicate) so the monitor tab
  // composition stays declarative.
  if (segment.type !== 'predicate' || !segment.game_id) return null;

  const m = payload && !payload.empty ? buildTrajectoryModel(payload) : null;

  return (
    <CardShell
      title="Cohort trajectory"
      icon={<Waypoints size={14} />}
      loading={loading}
      error={error}
      skeletonShape="lines"
      cardKey="trajectory"
      trailing={
        m ? (
          <>
            <Chip tone="success">{`latest ${m.latestDate}`}</Chip>
            {m.gapCount > 0 && <Chip tone="warning">{`${m.gapCount} night${m.gapCount > 1 ? 's' : ''} missed`}</Chip>}
          </>
        ) : undefined
      }
    >
      {m == null ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          No snapshots yet — the first nightly snapshot lands tonight, history accrues from then on.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ width: 132, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12, borderRight: '1px solid var(--border-card)', paddingRight: 14 }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Members</div>
              <div style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.15 }}>{fmtCompact(m.latestMembers)}</div>
              {m.windowChangePct != null && (
                <div style={{ fontSize: 11, fontWeight: 600, color: m.windowChangePct >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                  {fmtPct(m.windowChangePct)} over window
                </div>
              )}
            </div>
            <Stat label="Entered · latest" value={m.latestEntered != null ? `+${fmtCompact(m.latestEntered)}` : '—'} tone="positive" />
            <Stat label="Exited · latest" value={m.latestExited != null ? `−${fmtCompact(m.latestExited)}` : '—'} tone="negative" />
          </div>
          <TrajectoryCharts m={m} />
        </div>
      )}
    </CardShell>
  );
}
