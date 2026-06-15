/**
 * SidebarSubheader — small uppercase mono label for sidebar subsections
 * (e.g. RECENTLY VIEWED groupings).
 */
import React from 'react';
import { T } from '../theme';

export function SidebarSubheader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: T.fMono, fontSize: 9.5, fontWeight: 600,
      color: 'var(--shell-text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em',
      padding: '8px 16px 4px 32px',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      {children}
    </div>
  );
}
