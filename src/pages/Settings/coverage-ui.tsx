/**
 * Shared UI primitives for the Metric coverage panel: status pill, mono code,
 * a collapsible disclosure section, and a multi-select game-filter chip row.
 * Kept separate so the section file stays focused on orchestration.
 */
import { ReactElement, ReactNode, useState } from 'react';
import styled from 'styled-components';
import { ChevronRight } from 'lucide-react';

export const Pill = styled.span<{ $tone: 'danger' | 'warn' | 'ok' | 'muted' }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 600;
  background: ${(p) =>
    p.$tone === 'danger' ? 'var(--destructive-soft)'
    : p.$tone === 'warn' ? 'var(--warning-soft)'
    : p.$tone === 'muted' ? 'var(--bg-muted)'
    : 'var(--success-soft)'};
  color: ${(p) =>
    p.$tone === 'danger' ? 'var(--destructive-ink)'
    : p.$tone === 'warn' ? 'var(--warning-ink)'
    : p.$tone === 'muted' ? 'var(--text-muted)'
    : 'var(--success-ink)'};
`;

export const Mono = styled.code`
  font-family: var(--font-mono, monospace);
  color: var(--text-primary);
`;

export const Note = styled.p`
  margin: 6px 0 0;
  font-size: 11.5px;
  color: var(--text-muted);
`;

// ── Collapsible disclosure ──────────────────────────────────────────────────
const Disc = styled.section`
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  margin-top: 12px;
  overflow: hidden;
`;

const DiscHead = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  background: var(--bg-muted);
  border: none;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  text-align: left;
  &:hover { color: var(--brand); }
`;

const Chevron = styled(ChevronRight)<{ $open: boolean }>`
  transition: transform 120ms ease;
  transform: rotate(${(p) => (p.$open ? 90 : 0)}deg);
  flex-shrink: 0;
`;

const DiscBody = styled.div`
  padding: 12px;
`;

interface CollapsibleProps {
  title: ReactNode;
  /** Right-aligned content in the header (counts, etc.). */
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Collapsible({ title, meta, defaultOpen = false, children }: CollapsibleProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Disc>
      <DiscHead type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Chevron size={15} $open={open} aria-hidden />
        <span style={{ flex: 1 }}>{title}</span>
        {meta}
      </DiscHead>
      {open ? <DiscBody>{children}</DiscBody> : null}
    </Disc>
  );
}

// ── Game-filter chips (multi-select) ────────────────────────────────────────
const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
`;

const Chip = styled.button<{ $active: boolean }>`
  height: 26px;
  padding: 0 11px;
  border-radius: var(--radius-pill);
  border: 1px solid ${(p) => (p.$active ? 'var(--brand)' : 'var(--border-card)')};
  background: ${(p) => (p.$active ? 'var(--brand-soft)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--brand)' : 'var(--text-secondary)')};
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  &:hover { border-color: var(--brand); color: var(--brand); }
`;

interface GameFilterProps {
  games: Array<{ id: string; status?: 'ok' | 'drift' | 'error' }>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onAll: () => void;
}

export function GameFilterChips({ games, selected, onToggle, onAll }: GameFilterProps): ReactElement {
  const allActive = selected.size === games.length;
  return (
    <ChipRow>
      <Chip type="button" $active={allActive} onClick={onAll}>All</Chip>
      {games.map((g) => (
        <Chip
          key={g.id}
          type="button"
          $active={selected.has(g.id)}
          onClick={() => onToggle(g.id)}
          title={g.status === 'error' ? 'meta unavailable for this game' : undefined}
        >
          {g.id}{g.status === 'error' ? ' ⚠' : ''}
        </Chip>
      ))}
    </ChipRow>
  );
}
