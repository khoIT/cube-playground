/**
 * Shared visual primitives for the per-user surfaces (Access controls + Activity
 * profile). Extracted so both the govern panel and the observe profile draw
 * from one token-backed source — no hex literals, tokens.css only.
 */

import React from 'react';
import type { AdminRole, AdminStatus } from '../access/use-admin-access';

export const card: React.CSSProperties = {
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-card)',
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  overflow: 'hidden',
};

export const cardBody: React.CSSProperties = { padding: '14px 16px' };

export const eyebrow: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
};

const STATUS_TOKENS: Record<AdminStatus, { bg: string; ink: string; label: string }> = {
  active: { bg: 'var(--success-soft)', ink: 'var(--success-ink)', label: 'Active' },
  pending: { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)', label: 'Pending' },
  disabled: { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', label: 'Disabled' },
};

export function StatusBadge({ status }: { status: AdminStatus }) {
  const t = STATUS_TOKENS[status] ?? STATUS_TOKENS.pending;
  return (
    <span
      style={{
        fontSize: 11, fontWeight: 600, padding: '2px 8px',
        borderRadius: 'var(--radius-full)', background: t.bg, color: t.ink,
        whiteSpace: 'nowrap',
      }}
    >
      {t.label}
    </span>
  );
}

export function RoleChip({ role }: { role: AdminRole }) {
  return (
    <span
      style={{
        fontSize: 11, fontWeight: 600, padding: '2px 8px',
        borderRadius: 'var(--radius-full)', background: 'var(--muted-soft)',
        color: 'var(--muted-ink)', textTransform: 'capitalize',
      }}
    >
      {role}
    </span>
  );
}

export function Initials({ email }: { email: string }) {
  const init = email.slice(0, 2).toUpperCase();
  return (
    <div
      style={{
        width: 36, height: 36, borderRadius: 'var(--radius-full)',
        background: 'var(--bg-muted)', border: '1px solid var(--border-card)',
        display: 'grid', placeItems: 'center',
        fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)',
        flexShrink: 0,
      }}
    >
      {init}
    </div>
  );
}

export interface StatProps {
  label: string;
  value: number | string;
  note?: string;
  noteTone?: string;
}

export function Stat({ label, value, note, noteTone }: StatProps) {
  return (
    <div style={{ background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
      <div style={eyebrow}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2, marginTop: 2, color: 'var(--text-primary)' }}>
        {value}
      </div>
      {note && <div style={{ fontSize: 11, color: noteTone ?? 'var(--text-muted)', marginTop: 2 }}>{note}</div>}
    </div>
  );
}

export function saveBtnStyle(busy: boolean): React.CSSProperties {
  return {
    background: 'var(--brand)', color: '#fff', border: 'none',
    borderRadius: 'var(--radius-sm)', padding: '5px 14px',
    fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.6 : 1, fontFamily: 'var(--font-sans)',
  };
}
