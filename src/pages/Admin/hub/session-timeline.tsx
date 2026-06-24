/**
 * SessionTimeline — renders the gap-derived session history for one user.
 *
 * Mirrors the server shape from session-aggregator.ts (GET
 * /api/admin/activity/users/:email/sessions). Sessions are NOT stored; they are
 * derived by gap-based sessionization (idle > 60 min ends a session). Each
 * session expands to show its events — feature opens and privacy-safe query
 * shapes (member NAMES only). tokens.css only.
 */

import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { eyebrow, card } from './per-user-shared';
import { FEATURE_LABEL, relativeTime, type QueryShape } from './per-user-panel-helpers';
import { QueryShapeInline } from './query-shape-detail';

export interface SessionEvent {
  ts: number;
  type: string;
  target: string | null;
  shape: QueryShape | null;
}

export interface UserSession {
  start: number;
  end: number;
  durationMs: number;
  events: SessionEvent[];
}

export interface UserSessions {
  sessions: UserSession[];
  sessions30: number;
  avgDurationMs: number;
  sparkline: number[];
}

/** Compact human duration: "0m" / "12m" / "1h 5m". */
export function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins <= 0) return '0m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function Sparkline({ values }: { values: number[] }) {
  const max = values.reduce((m, v) => Math.max(m, v), 0) || 1;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 36 }} aria-hidden>
      {values.map((v, i) => (
        <span
          key={i}
          title={`${v} event(s)`}
          style={{
            flex: 1, minWidth: 2,
            height: `${Math.max((v / max) * 100, v > 0 ? 8 : 2)}%`,
            background: v > 0 ? 'var(--brand)' : 'var(--border-card)',
            borderRadius: 'var(--radius-sm)',
          }}
        />
      ))}
    </div>
  );
}

type EventTone = 'info' | 'muted' | 'success';
const TONE_BG: Record<EventTone, string> = {
  info: 'var(--info-soft)', muted: 'var(--muted-soft)', success: 'var(--success-soft)',
};
const TONE_INK: Record<EventTone, string> = {
  info: 'var(--info-ink)', muted: 'var(--muted-ink)', success: 'var(--success-ink)',
};

/**
 * Maps a non-query event to its badge label, tone, and human body text.
 * `cube_outage` is filtered out server-side (it's backend-health telemetry, not
 * user activity), so the timeline only carries real actions. segment_op carries
 * an opaque segment id, so it shows the action word with no raw id body.
 */
function describeEvent(ev: SessionEvent): { badge: string; tone: EventTone; body: string | null } {
  switch (ev.type) {
    case 'feature_open':
      return { badge: 'open', tone: 'muted', body: ev.target ? (FEATURE_LABEL[ev.target] ?? ev.target) : 'feature' };
    case 'segment_op':
      return { badge: 'segment', tone: 'success', body: null };
    case 'workspace_switch':
      return { badge: 'workspace', tone: 'muted', body: ev.target };
    case 'export':
      return { badge: 'export', tone: 'muted', body: ev.target };
    default:
      return { badge: ev.type, tone: 'muted', body: ev.target };
  }
}

function EventBadge({ tone, children }: { tone: EventTone; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 'var(--radius-full)',
        background: TONE_BG[tone], color: TONE_INK[tone], whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

function EventRow({ ev }: { ev: SessionEvent }) {
  if (ev.type === 'query_run') {
    return (
      <li style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0' }}>
        <EventBadge tone="info">query</EventBadge>
        {ev.shape ? (
          <QueryShapeInline shape={ev.shape} />
        ) : (
          <span style={{ fontSize: 11.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'var(--text-secondary)' }}>query</span>
        )}
      </li>
    );
  }
  const { badge, tone, body } = describeEvent(ev);
  return (
    <li style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0' }}>
      <EventBadge tone={tone}>{badge}</EventBadge>
      {body && <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{body}</span>}
    </li>
  );
}

function SessionCard({ session, index }: { session: UserSession; index: number }) {
  const [open, setOpen] = useState(index === 0); // newest expanded by default
  return (
    <div style={{ border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
          background: 'var(--bg-muted)', border: 'none', cursor: 'pointer', textAlign: 'left',
          fontFamily: 'var(--font-sans)',
        }}
        aria-expanded={open}
      >
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
          {relativeTime(new Date(session.start).toISOString())}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          {formatDuration(session.durationMs)} · {session.events.length} event(s)
        </span>
        {/* Decorative boxed chevron (the whole row is the toggle button) — a
            real 24px target, not the old ~10px glyph. */}
        <span
          aria-hidden
          style={{
            marginLeft: 'auto', width: 24, height: 24, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-card)', color: 'var(--text-secondary)',
            transition: 'transform 0.15s ease', transform: open ? 'rotate(90deg)' : 'none',
          }}
        >
          <ChevronRight size={14} strokeWidth={2.5} />
        </span>
      </button>
      {open && (
        <ul style={{ listStyle: 'none', margin: 0, padding: '6px 12px 10px' }}>
          {session.events.length === 0 ? (
            <li style={{ fontSize: 12, color: 'var(--text-muted)' }}>no events</li>
          ) : (
            session.events.map((ev, i) => <EventRow key={i} ev={ev} />)
          )}
        </ul>
      )}
    </div>
  );
}

export function SessionTimeline({ data, loading }: { data: UserSessions | null; loading: boolean }) {
  return (
    <section style={{ ...card, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Session history</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          {data ? `${data.sessions30} session(s) · avg ${formatDuration(data.avgDurationMs)} · last 30d` : ''}
        </span>
      </div>

      {data && data.sparkline.some((v) => v > 0) && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...eyebrow, marginBottom: 4 }}>Daily activity · 30d</div>
          <Sparkline values={data.sparkline} />
        </div>
      )}

      {loading && !data ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading sessions…</div>
      ) : !data || data.sessions.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No sessions recorded in the last 30 days.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.sessions.map((s, i) => <SessionCard key={s.start} session={s} index={i} />)}
        </div>
      )}
    </section>
  );
}
