/**
 * Three schedule cards for a served segment: capture cadence, last snapshot, and
 * next-ready (counted down to the GMT+7 window). Reads the computed serving
 * contract — never re-derives the schedule client-side.
 */

import { ReactElement } from 'react';
import { CalendarClock, History, Clock } from 'lucide-react';
import type { ServingContract } from '../../../../../types/segment-api';
import { gmt7DateTime, relative, readyIn } from './serving-format';

const card: React.CSSProperties = {
  flex: '1 1 180px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg, 10px)',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};
const label: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-muted)',
};
const value: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' };
const sub: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)' };

export function SnapshotScheduleCards({ serving }: { serving: ServingContract }): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      <div style={card}>
        <span style={label}>
          <CalendarClock size={13} aria-hidden /> Cadence
        </span>
        <span style={value}>{serving.cadence === 'Off' ? 'On demand' : serving.cadence}</span>
        <span style={sub}>
          {serving.snapshotEnabled ? 'Snapshotting enabled' : 'Snapshotting disabled on this instance'}
        </span>
      </div>
      <div style={card}>
        <span style={label}>
          <History size={13} aria-hidden /> Last snapshot
        </span>
        <span style={value}>{relative(serving.lastSnapshotAt)}</span>
        <span style={sub}>{gmt7DateTime(serving.lastSnapshotAt)} GMT+7</span>
      </div>
      <div style={card}>
        <span style={label}>
          <Clock size={13} aria-hidden /> Next ready
        </span>
        <span style={value}>{readyIn(serving.nextReadyAt)}</span>
        <span style={sub}>{serving.nextReadyAt ? `${gmt7DateTime(serving.nextReadyAt)} GMT+7` : 'no schedule'}</span>
      </div>
    </div>
  );
}
