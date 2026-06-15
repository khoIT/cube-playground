/**
 * Shared primitives for grouped + selectable catalog views.
 *
 * Pieces here:
 *  - `GroupHeader`        — collapsible group title row (chevron + label + count + optional select-all checkbox)
 *  - `SelectionBanner`    — floats above the grid when at least one item is selected, with a "Clear" reset
 *  - `SelectionCheckbox`  — small overlay checkbox the card/row anchors in its top-left corner
 *
 * Page-level state (group collapse map, selection set) stays in the consuming
 * tab — these primitives are presentational so they fit both Metrics and
 * Data Model catalogs.
 */

import React from 'react';
import styled from 'styled-components';
import { ChevronDown, X } from 'lucide-react';

const HeaderRow = styled.button`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 16px;
  margin: 12px 0 4px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--text-secondary);

  &:hover {
    color: var(--brand);
  }
`;

const Chevron = styled.span<{ $collapsed: boolean }>`
  display: inline-flex;
  transform: rotate(${(p) => (p.$collapsed ? '-90deg' : '0deg')});
  transition: transform 0.15s ease;
  color: var(--text-muted);
`;

const Label = styled.span`
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const CountChip = styled.span`
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
`;

const SelectAllSlot = styled.span`
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
`;

interface GroupHeaderProps {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  selectedInGroup?: number;
  allSelectedInGroup?: boolean;
  onSelectAll?: (allSelected: boolean) => void;
}

export function GroupHeader({
  label,
  count,
  collapsed,
  onToggle,
  selectedInGroup,
  allSelectedInGroup,
  onSelectAll,
}: GroupHeaderProps) {
  return (
    <HeaderRow
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
    >
      <Chevron $collapsed={collapsed}>
        <ChevronDown size={14} />
      </Chevron>
      <Label>{label}</Label>
      <CountChip>{count}</CountChip>
      {onSelectAll && (
        <SelectAllSlot onClick={(e) => e.stopPropagation()}>
          {selectedInGroup ? `${selectedInGroup} selected` : ''}
          <input
            type="checkbox"
            checked={!!allSelectedInGroup}
            // Indeterminate is set imperatively so React doesn't warn about
            // the missing prop; covers the partial-selection visual state.
            ref={(el) => {
              if (el) {
                el.indeterminate =
                  !!selectedInGroup && !allSelectedInGroup;
              }
            }}
            onChange={(e) => onSelectAll(e.target.checked)}
            aria-label={`Select all ${label}`}
          />
        </SelectAllSlot>
      )}
    </HeaderRow>
  );
}

const Banner = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin: 0 16px 4px;
  padding: 6px 8px 6px 12px;
  border-radius: 999px;
  background: rgba(240, 90, 34, 0.10);
  color: var(--brand);
  font-size: 12px;
  font-weight: 500;
`;

const ClearBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: 999px;
  background: rgba(240, 90, 34, 0.18);
  color: inherit;
  cursor: pointer;

  &:hover {
    background: rgba(240, 90, 34, 0.28);
  }
`;

interface SelectionBannerProps {
  count: number;
  onClear: () => void;
  /** Optional inline action slot — e.g. "Add to workspace" buttons. */
  actions?: React.ReactNode;
}

export function SelectionBanner({ count, onClear, actions }: SelectionBannerProps) {
  if (count === 0) return null;
  return (
    <Banner role="status">
      <span>{count} selected</span>
      {actions}
      <ClearBtn type="button" onClick={onClear} aria-label="Clear selection">
        <X size={12} />
        Clear
      </ClearBtn>
    </Banner>
  );
}

const CheckboxWrap = styled.label<{ $active: boolean }>`
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: ${(p) => (p.$active ? 'var(--brand)' : 'transparent')};
  border: 1px solid
    ${(p) => (p.$active ? 'var(--brand)' : 'var(--border-card)')};
  cursor: pointer;
  opacity: ${(p) => (p.$active ? 1 : 0.85)};

  input {
    margin: 0;
    width: 14px;
    height: 14px;
    accent-color: var(--brand);
    cursor: pointer;
  }

  &:hover {
    opacity: 1;
    border-color: var(--brand);
  }
`;

interface SelectionCheckboxProps {
  checked: boolean;
  onToggle: () => void;
  ariaLabel?: string;
}

/** Top-left overlay checkbox the card/row anchors with `position: relative`. */
export function SelectionCheckbox({ checked, onToggle, ariaLabel }: SelectionCheckboxProps) {
  return (
    <CheckboxWrap
      $active={checked}
      onClick={(e) => {
        // Don't let the surrounding <Link> swallow the click.
        e.stopPropagation();
        e.preventDefault();
        onToggle();
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        aria-label={ariaLabel ?? 'Select item'}
      />
    </CheckboxWrap>
  );
}

/** Helper for collapse-state maps stored in a Set of group keys. */
export function toggleSetMember<T>(set: Set<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
