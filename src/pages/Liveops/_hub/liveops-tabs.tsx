/**
 * Shared tab bar for LiveOps sub-hubs (Diagnostics, Alerts & Digests).
 *
 * Generalizes the Ops Console tab bar (OpsConsole/ops-console-tabs.tsx) so every
 * LiveOps hub renders an identical underline-tab strip instead of bespoke CSS per
 * hub. Tabs are data-driven; the active id + change handler come from
 * use-liveops-tab (query-param synced so deep links survive).
 */
import React from 'react';
import type { LucideIcon } from 'lucide-react';

export interface LiveopsHubTab<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

interface LiveopsTabsProps<T extends string> {
  tabs: LiveopsHubTab<T>[];
  active: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
}

export function LiveopsTabs<T extends string>({
  tabs,
  active,
  onChange,
  ariaLabel,
}: LiveopsTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel ?? 'LiveOps sections'}
      style={{
        display: 'flex',
        gap: 4,
        borderBottom: '1px solid var(--border-card)',
        marginBottom: 20,
        fontFamily: 'var(--font-sans)',
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '9px 14px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
              color: isActive ? 'var(--brand)' : 'var(--text-muted)',
              borderBottom: isActive ? '2px solid var(--brand)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            <Icon size={15} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
