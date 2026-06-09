/**
 * CsActivityStrip — rolling 24h care-action summary for the CS Monitor.
 *
 * Renders "N treated · M dismissed · K resolved (last 24 h)" plus up to 5
 * recent individual events showing uid, action kind, and local time in GMT+7
 * (Asia/Ho_Chi_Minh). Times are displayed in GMT+7 per project convention.
 *
 * Data is polled automatically via useCareActivity; the strip self-heals on
 * transient errors and shows a skeleton while loading.
 */

import React from 'react';
import { Activity } from 'lucide-react';
import { useCareActivity } from './use-care-cases';
import type { ActivityEvent } from './use-care-cases';

// ── GMT+7 formatter ───────────────────────────────────────────────────────────

/** Formats an ISO UTC timestamp as HH:mm in GMT+7 (e.g. "14:32"). */
function toGmt7Time(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

// ── Kind label + color ────────────────────────────────────────────────────────

const KIND_LABEL: Record<ActivityEvent['kind'], string> = {
  treated: 'Treated',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

const KIND_COLOR: Record<ActivityEvent['kind'], string> = {
  treated: 'var(--success-ink)',
  resolved: 'var(--info-ink)',
  dismissed: 'var(--muted-ink)',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function CountChip({ label, n, color }: { label: string; n: number; color: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: 'var(--font-sans)',
        color,
      }}
    >
      <span
        style={{
          fontVariantNumeric: 'tabular-nums',
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        {n}
      </span>
      <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>{label}</span>
    </span>
  );
}

function Divider() {
  return (
    <span
      aria-hidden
      style={{ color: 'var(--border-strong)', fontSize: 13, userSelect: 'none' }}
    >
      ·
    </span>
  );
}

// ── Strip ─────────────────────────────────────────────────────────────────────

interface Props {
  gameId: string;
}

/** Maximum recent events rendered in the feed row. */
const MAX_RECENT = 5;

export function CsActivityStrip({ gameId }: Props) {
  const { status, treated24h, dismissed24h, resolved24h, recent, error } =
    useCareActivity(gameId);

  if (!gameId) return null;

  const loading = status === 'idle' || status === 'loading';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 14px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-md)',
        marginBottom: 16,
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Activity size={14} color="var(--brand)" aria-hidden />
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: 'var(--text-muted)',
          }}
        >
          Last 24 h
        </span>

        {loading && (
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              marginLeft: 4,
            }}
          >
            loading…
          </span>
        )}

        {status === 'error' && (
          <span
            style={{
              fontSize: 11,
              color: 'var(--destructive-ink)',
              marginLeft: 4,
            }}
          >
            {error}
          </span>
        )}

        {status === 'success' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 4 }}>
            <CountChip label="treated" n={treated24h} color="var(--success-ink)" />
            <Divider />
            <CountChip label="dismissed" n={dismissed24h} color="var(--muted-ink)" />
            <Divider />
            <CountChip label="resolved" n={resolved24h} color="var(--info-ink)" />
          </div>
        )}
      </div>

      {/* Recent events feed (only when there is activity) */}
      {status === 'success' && recent.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          {recent.slice(0, MAX_RECENT).map((ev, i) => (
            <span
              // Index key is fine: list is short, static within a render.
              key={i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontFamily: 'var(--font-sans)',
                background: 'var(--bg-muted)',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-full)',
                padding: '2px 9px',
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  color: KIND_COLOR[ev.kind],
                  textTransform: 'capitalize',
                }}
              >
                {KIND_LABEL[ev.kind]}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>·</span>
              <span
                style={{
                  fontWeight: 600,
                  maxWidth: 80,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={ev.uid}
              >
                {ev.uid}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>·</span>
              {/* Time displayed in GMT+7 per project convention */}
              <span style={{ color: 'var(--text-muted)' }}>{toGmt7Time(ev.at)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
