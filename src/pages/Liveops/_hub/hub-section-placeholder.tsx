/**
 * Neutral "this surface is being built" panel for LiveOps hub tabs whose body
 * lands in a later build step. Token-styled so the scaffold reads as intentional,
 * not broken. Each consuming tab replaces this with its real view.
 */
import React from 'react';
import type { LucideIcon } from 'lucide-react';

export function HubSectionPlaceholder({
  icon: Icon,
  title,
  note,
}: {
  icon: LucideIcon;
  title: string;
  note: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        textAlign: 'center',
        minHeight: 280,
        padding: 32,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-xl)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <Icon size={28} style={{ color: 'var(--text-muted)' }} />
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', maxWidth: '46ch' }}>{note}</div>
    </div>
  );
}
