/**
 * ViewModeToggle — paired icon buttons (grid | list) for switching between
 * card-grid and compact-list layouts on catalog pages. Reads / writes via
 * view-mode-store so the choice persists and propagates.
 */

import React from 'react';
import styled from 'styled-components';
import { LayoutGrid, List } from 'lucide-react';

import {
  getViewMode,
  onViewModeChange,
  setViewMode,
  type ViewMode,
  type ViewModule,
} from './view-mode-store';

const Group = styled.div`
  display: inline-flex;
  align-items: center;
  height: 34px;
  border: 1px solid var(--border-card);
  border-radius: 6px;
  overflow: hidden;
`;

const Btn = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 100%;
  border: 0;
  background: ${(p) =>
    p.$active ? 'rgba(240, 90, 34, 0.10)' : 'transparent'};
  color: ${(p) =>
    p.$active ? 'var(--brand)' : 'var(--text-muted)'};
  cursor: pointer;

  &:hover {
    color: var(--brand);
  }

  & + & {
    border-left: 1px solid var(--border-card);
  }
`;

interface ViewModeToggleProps {
  module: ViewModule;
  /** Optional controlled override; defaults to localStorage-backed state. */
  value?: ViewMode;
  onChange?: (mode: ViewMode) => void;
}

export function ViewModeToggle({ module, value, onChange }: ViewModeToggleProps) {
  const [internal, setInternal] = React.useState<ViewMode>(() =>
    value ?? getViewMode(module),
  );

  React.useEffect(() => {
    if (value !== undefined) return;
    return onViewModeChange(module, setInternal);
  }, [module, value]);

  const mode = value ?? internal;

  function pick(next: ViewMode) {
    if (next === mode) return;
    if (value === undefined) {
      setInternal(next);
      setViewMode(module, next);
    }
    onChange?.(next);
  }

  return (
    <Group role="group" aria-label="View mode">
      <Btn
        type="button"
        $active={mode === 'grid'}
        onClick={() => pick('grid')}
        aria-pressed={mode === 'grid'}
        title="Grid view"
      >
        <LayoutGrid size={14} />
      </Btn>
      <Btn
        type="button"
        $active={mode === 'list'}
        onClick={() => pick('list')}
        aria-pressed={mode === 'list'}
        title="Compact list view"
      >
        <List size={14} />
      </Btn>
    </Group>
  );
}

export function useViewMode(module: ViewModule): [ViewMode, (next: ViewMode) => void] {
  const [mode, setMode] = React.useState<ViewMode>(() => getViewMode(module));
  React.useEffect(() => onViewModeChange(module, setMode), [module]);
  return [mode, (next) => setViewMode(module, next)];
}
