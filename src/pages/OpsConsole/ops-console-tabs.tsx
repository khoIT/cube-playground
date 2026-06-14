/**
 * Tab bar for the Ops Console — Overview / Members / Care.
 * The page owns the active-tab state and unmounts the inactive tab bodies
 * (so the Care tab's 30s activity poll stops when the user navigates away).
 */
import React from 'react';
import { BarChart3, UserSearch, HeartHandshake, type LucideIcon } from 'lucide-react';

export type OpsTab = 'overview' | 'members' | 'care';

export const OPS_TABS: { id: OpsTab; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'members', label: 'Members', icon: UserSearch },
  { id: 'care', label: 'Care', icon: HeartHandshake },
];

export function isOpsTab(v: string | null | undefined): v is OpsTab {
  return v === 'overview' || v === 'members' || v === 'care';
}

interface OpsConsoleTabsProps {
  active: OpsTab;
  onChange: (next: OpsTab) => void;
}

export function OpsConsoleTabs({ active, onChange }: OpsConsoleTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Ops Console sections"
      style={{
        display: 'flex',
        gap: 4,
        borderBottom: '1px solid var(--border-card)',
        marginBottom: 20,
        fontFamily: 'var(--font-sans)',
      }}
    >
      {OPS_TABS.map((tab) => {
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
