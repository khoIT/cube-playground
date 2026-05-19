/** Shared wrapper that gives chart cards a consistent header + body + loading state. */

import { ReactNode, ReactElement } from 'react';

interface Props {
  title: string;
  loading?: boolean;
  error?: Error | null;
  children: ReactNode;
}

export function CardShell({ title, loading, error, children }: Props): ReactElement {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
        {title}
      </h3>
      {loading ? (
        <div style={{ height: 120, background: 'var(--neutral-100)', borderRadius: 6, opacity: 0.6 }} />
      ) : error ? (
        <div style={{ fontSize: 12, color: 'var(--text-danger, #c0392b)' }}>{error.message}</div>
      ) : (
        children
      )}
    </div>
  );
}
