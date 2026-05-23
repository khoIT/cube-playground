/**
 * Vertical tab rail for the settings page. Renders icon + label per tab,
 * highlights the active entry, and supports arrow-key navigation in line
 * with the WAI-ARIA tabs pattern (vertical orientation).
 */

import React, { ReactElement } from 'react';
import styled from 'styled-components';
import type { LucideIcon } from 'lucide-react';

export interface SettingsTabDescriptor {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface SettingsTabsProps {
  tabs: SettingsTabDescriptor[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}

const TabList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-xs);
  align-self: flex-start;
  min-width: 220px;
`;

const TabButton = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  background: ${(p) => (p.$active ? 'var(--brand-soft)' : 'transparent')};
  border: none;
  border-radius: var(--radius-card);
  color: ${(p) => (p.$active ? 'var(--brand)' : 'var(--text-secondary)')};
  font-family: var(--font-sans);
  font-size: 13.5px;
  font-weight: ${(p) => (p.$active ? 600 : 500)};
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;

  &:hover {
    background: ${(p) => (p.$active ? 'var(--brand-soft)' : 'var(--bg-muted)')};
    color: ${(p) => (p.$active ? 'var(--brand)' : 'var(--text-primary)')};
  }

  &:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 1px;
  }
`;

const TabIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
`;

export function SettingsTabs({
  tabs,
  activeId,
  onChange,
  ariaLabel,
}: SettingsTabsProps): ReactElement {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
      return;
    }
    e.preventDefault();
    let next = index;
    if (e.key === 'ArrowDown') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    refs.current[next]?.focus();
    onChange(tabs[next].id);
  };

  return (
    <TabList role="tablist" aria-orientation="vertical" aria-label={ariaLabel}>
      {tabs.map((tab, i) => {
        const active = tab.id === activeId;
        const Icon = tab.icon;
        return (
          <TabButton
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`settings-tab-${tab.id}`}
            aria-selected={active}
            aria-controls={`settings-panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            $active={active}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, i)}
          >
            <TabIcon aria-hidden>
              <Icon size={16} strokeWidth={1.75} />
            </TabIcon>
            {tab.label}
          </TabButton>
        );
      })}
    </TabList>
  );
}

export default SettingsTabs;
