/**
 * FilterChipBar — horizontal toolbar of facet chips for catalog top bars.
 * Replaces the legacy left filter rail. Each chip is a button + popover with
 * its own facet UI (checkbox list, toggle, etc.).
 */

import React from 'react';
import styled from 'styled-components';
import { ChevronDown } from 'lucide-react';

const Bar = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
`;

const ChipWrap = styled.div`
  position: relative;
`;

const ChipButton = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid
    ${(p) => (p.$active ? 'var(--brand)' : 'var(--border-card)')};
  border-radius: 999px;
  background: ${(p) =>
    p.$active ? 'rgba(240, 90, 34, 0.08)' : 'var(--bg-card)'};
  color: ${(p) =>
    p.$active ? 'var(--brand)' : 'var(--text-secondary)'};
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;

  &:hover {
    border-color: var(--brand);
    color: var(--brand);
  }
`;

const ChipBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--brand);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
`;

const Popover = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 50;
  min-width: 200px;
  max-height: 320px;
  overflow-y: auto;
  padding: 8px 4px;
  border: 1px solid var(--border-card);
  border-radius: 8px;
  background: var(--bg-card);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
`;

const Option = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12.5px;
  color: var(--text-secondary);
  cursor: pointer;

  &:hover {
    background: rgba(0, 0, 0, 0.04);
  }
`;

const EmptyHint = styled.div`
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-muted);
`;

interface FilterChipProps {
  label: string;
  /** Visible badge with active selection count when > 0. */
  count?: number;
  /** Renders the chip in the active style even with count == 0 (used for booleans). */
  forceActive?: boolean;
  children: React.ReactNode;
}

/** Anchor + popover primitive. Caller renders whatever facet UI inside. */
export function FilterChip({ label, count = 0, forceActive, children }: FilterChipProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (ev: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const active = forceActive || count > 0;

  return (
    <ChipWrap ref={ref}>
      <ChipButton
        type="button"
        $active={active}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {label}
        {count > 0 && <ChipBadge>{count}</ChipBadge>}
        <ChevronDown size={12} />
      </ChipButton>
      {open && <Popover>{children}</Popover>}
    </ChipWrap>
  );
}

interface OptionDef<T> {
  value: T;
  label: string;
}

interface MultiSelectChipProps<T extends string | number> {
  label: string;
  options: ReadonlyArray<T> | ReadonlyArray<OptionDef<T>>;
  selected: Set<T>;
  onChange: (next: Set<T>) => void;
  /** Empty-list hint, e.g. "No cubes available". */
  emptyHint?: string;
}

function isOptionDef<T>(v: T | OptionDef<T>): v is OptionDef<T> {
  return typeof v === 'object' && v !== null && 'value' in (v as object);
}

/** Multi-select facet chip with checkbox list inside its popover. */
export function MultiSelectChip<T extends string | number>({
  label,
  options,
  selected,
  onChange,
  emptyHint,
}: MultiSelectChipProps<T>) {
  function toggle(v: T) {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  }

  return (
    <FilterChip label={label} count={selected.size}>
      {options.length === 0 ? (
        <EmptyHint>{emptyHint ?? 'No options'}</EmptyHint>
      ) : (
        options.map((opt) => {
          const v = isOptionDef(opt) ? opt.value : opt;
          const text = isOptionDef(opt) ? opt.label : String(opt);
          return (
            <Option key={String(v)}>
              <input
                type="checkbox"
                checked={selected.has(v)}
                onChange={() => toggle(v)}
              />
              {text}
            </Option>
          );
        })
      )}
    </FilterChip>
  );
}

interface ToggleDef {
  key: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}

interface ToggleGroupChipProps {
  label: string;
  toggles: ToggleDef[];
}

/** Boolean-group chip — collapses N independent boolean filters into one popover. */
export function ToggleGroupChip({ label, toggles }: ToggleGroupChipProps) {
  const activeCount = toggles.filter((t) => t.checked).length;
  return (
    <FilterChip label={label} count={activeCount}>
      {toggles.map((t) => (
        <Option key={t.key}>
          <input type="checkbox" checked={t.checked} onChange={t.onChange} />
          {t.label}
        </Option>
      ))}
    </FilterChip>
  );
}

interface FilterChipBarProps {
  children: React.ReactNode;
  /** Trailing slot — typically a "Clear all" button or count summary. */
  trailing?: React.ReactNode;
}

export function FilterChipBar({ children, trailing }: FilterChipBarProps) {
  return (
    <Bar>
      {children}
      {trailing}
    </Bar>
  );
}

// ── Inline pill primitives — used when filters must surface their options
// without a dropdown click (e.g. catalog top bars where discoverability beats
// compactness). Each `FilterPillRow` shows label + every option as a pill;
// `TogglePill` covers standalone boolean filters.

const PillRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 0;
`;

const PillRowLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-right: 4px;
`;

const Pill = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid
    ${(p) =>
      p.$active ? 'var(--brand)' : 'var(--border-card)'};
  border-radius: 999px;
  background: ${(p) =>
    p.$active ? 'rgba(240, 90, 34, 0.10)' : 'var(--bg-card)'};
  color: ${(p) =>
    p.$active ? 'var(--brand)' : 'var(--text-secondary)'};
  font-size: 12px;
  cursor: pointer;

  &:hover {
    border-color: var(--brand);
    color: var(--brand);
  }
`;

interface FilterPillRowProps<T extends string | number> {
  /** Row label — accepts a node so callers can append an info icon, badge, etc. */
  label: React.ReactNode;
  options: ReadonlyArray<T> | ReadonlyArray<OptionDef<T>>;
  selected: Set<T>;
  onChange: (next: Set<T>) => void;
  /** When the option list is empty, render this hint instead of an empty row. */
  emptyHint?: string;
  /**
   * Optional per-option renderer. Used by surfaces that want to display
   * their own chip style (e.g. trust filter using TrustBadge). The row
   * chrome (label, layout, empty hint) is reused; only the chip changes.
   */
  renderOption?: (value: T, active: boolean, toggle: () => void) => React.ReactNode;
}

export function FilterPillRow<T extends string | number>({
  label,
  options,
  selected,
  onChange,
  emptyHint,
  renderOption,
}: FilterPillRowProps<T>) {
  function toggle(v: T) {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  }
  return (
    <PillRow>
      <PillRowLabel>{label}</PillRowLabel>
      {options.length === 0 ? (
        <EmptyHint>{emptyHint ?? 'No options'}</EmptyHint>
      ) : (
        options.map((opt) => {
          const v = isOptionDef(opt) ? opt.value : opt;
          const text = isOptionDef(opt) ? opt.label : String(opt);
          const active = selected.has(v);
          if (renderOption) {
            return (
              <React.Fragment key={String(v)}>
                {renderOption(v, active, () => toggle(v))}
              </React.Fragment>
            );
          }
          return (
            <Pill
              key={String(v)}
              type="button"
              $active={active}
              onClick={() => toggle(v)}
              aria-pressed={active}
            >
              {text}
            </Pill>
          );
        })
      )}
    </PillRow>
  );
}

interface TogglePillProps {
  label: string;
  checked: boolean;
  onChange: () => void;
}

export function TogglePill({ label, checked, onChange }: TogglePillProps) {
  return (
    <Pill type="button" $active={checked} onClick={onChange} aria-pressed={checked}>
      {label}
    </Pill>
  );
}

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

interface FilterPillStackProps {
  children: React.ReactNode;
}

/** Vertical stack of `FilterPillRow` rows — typical container for catalog top bars. */
export function FilterPillStack({ children }: FilterPillStackProps) {
  return <Stack>{children}</Stack>;
}
