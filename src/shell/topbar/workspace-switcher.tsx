/**
 * Workspace switcher chip — sits left of the GamePicker in the topbar.
 *
 * Pure visual switcher: tapping a workspace updates context state,
 * persists to localStorage, and dispatches `gds-cube:workspace-change`
 * so meta loaders refetch.
 */

import { Dropdown, message } from 'antd';
import { ChevronDown, Check, Database } from 'lucide-react';
import styled from 'styled-components';

import {
  useWorkspaceContext,
  type WorkspaceDef,
} from '../../components/workspace-context';

const Chip = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 10px;
  background: var(--hermes-panel);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease;

  &:hover,
  &:focus-visible {
    border-color: var(--brand);
    color: var(--brand);
  }
`;

const Mark = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-pill);
  background: var(--muted-soft);
  color: var(--muted-ink);
  flex-shrink: 0;
`;

const Name = styled.span`
  white-space: nowrap;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Chevron = styled(ChevronDown)`
  width: 14px;
  height: 14px;
  color: var(--text-muted);
`;

const Shell = styled.div`
  width: 260px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-md);
  padding: 4px 0;
  overflow: hidden;
  font-family: var(--font-sans);
`;

const Row = styled.button<{ $active: boolean }>`
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: ${(p) => (p.$active ? 'var(--brand-soft)' : 'transparent')};
  border: none;
  text-align: left;
  cursor: pointer;
  transition: background 100ms ease;

  &:hover {
    background: ${(p) => (p.$active ? 'var(--brand-soft)' : 'var(--bg-muted)')};
  }
`;

const RowMeta = styled.span`
  flex: 1;
  display: inline-flex;
  flex-direction: column;
  line-height: 1.2;
  min-width: 0;
`;

const RowName = styled.span<{ $active: boolean }>`
  font-size: 13.5px;
  font-weight: ${(p) => (p.$active ? 600 : 500)};
  color: ${(p) => (p.$active ? 'var(--brand)' : 'var(--text-primary)')};
`;

const RowId = styled.span<{ $active: boolean }>`
  margin-top: 1px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: ${(p) => (p.$active ? 'var(--brand)' : 'var(--text-muted)')};
`;

const CheckSlot = styled.span`
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const CheckMark = styled(Check)`
  width: 14px;
  height: 14px;
  color: var(--brand);
`;

function workspaceShortLabel(w: WorkspaceDef): string {
  // "Local dev" → "Local", "Prod cube-dev" → "Prod"
  return w.label.split(/\s+/)[0] ?? w.id;
}

export function WorkspaceSwitcher() {
  const { workspaceId, workspaces, setWorkspaceId, ready } = useWorkspaceContext();
  // Don't render until we know what workspaces exist — avoids a flash of an
  // empty chip before the registry fetch resolves.
  if (!ready || workspaces.length === 0) return null;
  const active = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0];

  const onSelect = (id: string) => {
    if (id === workspaceId) return;
    const next = workspaces.find((w) => w.id === id);
    setWorkspaceId(id);
    if (next) {
      message.success(`Switched to ${next.label}`);
    }
  };

  const overlay = (
    <Shell role="menu" aria-label="Active Cube workspace">
      {workspaces.map((w) => {
        const isActive = w.id === active.id;
        return (
          <Row
            key={w.id}
            type="button"
            role="menuitemradio"
            aria-checked={isActive}
            $active={isActive}
            onClick={() => onSelect(w.id)}
          >
            <Mark>
              <Database size={11} />
            </Mark>
            <RowMeta>
              <RowName $active={isActive}>{w.label}</RowName>
              <RowId $active={isActive}>{w.id}</RowId>
            </RowMeta>
            <CheckSlot aria-hidden>{isActive ? <CheckMark /> : null}</CheckSlot>
          </Row>
        );
      })}
    </Shell>
  );

  return (
    <Dropdown overlay={overlay} trigger={['click']} placement="bottomLeft">
      <Chip type="button" aria-label="Active Cube workspace">
        <Mark>
          <Database size={11} />
        </Mark>
        <Name>{workspaceShortLabel(active)}</Name>
        <Chevron />
      </Chip>
    </Dropdown>
  );
}
