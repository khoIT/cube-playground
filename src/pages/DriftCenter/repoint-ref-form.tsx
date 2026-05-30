/**
 * Repoint a broken reference: `from` is prefilled (the unresolved ref) and `to`
 * is chosen from a searchable dropdown of live `/meta` members for the active
 * workspace+game. No free-text member entry — the server still re-validates the
 * target as a backstop and 400s if it doesn't resolve, surfaced inline.
 *
 * The member dropdown renders through a portal anchored with `position: fixed`
 * to the trigger's viewport rect, so it is NEVER clipped by an ancestor's
 * `overflow: hidden` (the resolve pane / cards) regardless of available height.
 */
import { ReactElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { ChevronDown } from 'lucide-react';
import type { DriftItem, MetaMember } from './use-drift-center';

const Form = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px;
  background: var(--bg-app);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
`;
const Col = styled.div<{ $grow?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 6px;
  ${(p) => (p.$grow ? 'flex: 1; min-width: 220px;' : '')}
`;
const FieldLabel = styled.label`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
`;
const ReadonlyInput = styled.input`
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11.5px;
`;
const FromSelect = styled.select`
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 11.5px;
  cursor: pointer;
`;
const SelectBox = styled.button<{ $open: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid ${(p) => (p.$open ? 'var(--brand)' : 'var(--border-card)')};
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 11.5px;
  cursor: pointer;
`;
const Arrow = styled.span`
  color: var(--text-muted);
  padding-bottom: 8px;
  font-size: 14px;
`;
/* Portal menu — fixed to the trigger rect, immune to ancestor overflow clipping. */
const Menu = styled.div`
  position: fixed;
  z-index: 1000;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
`;
const Search = styled.div`
  padding: 8px;
  border-bottom: 1px solid var(--border-card);
  & input {
    width: 100%;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--border-card);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }
`;
const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 4px;
  overflow: auto;
`;
const Item = styled.li<{ $sel: boolean }>`
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: ${(p) => (p.$sel ? 'var(--text-primary)' : 'var(--text-secondary)')};
  background: ${(p) => (p.$sel ? 'var(--brand-soft)' : 'transparent')};
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  &:hover { background: var(--bg-muted); }
`;
const Tag = styled.span<{ $kind: 'measure' | 'dimension' }>`
  margin-left: auto;
  font-family: var(--font-sans);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${(p) => (p.$kind === 'measure' ? 'var(--warning-ink)' : 'var(--info-ink)')};
`;
const SubmitBtn = styled.button`
  display: inline-flex;
  align-items: center;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--brand);
  color: var(--text-on-brand);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  padding: 7px 16px;
  cursor: pointer;
  &:hover:not(:disabled) { background: var(--brand-hover); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const ErrorNote = styled.p`
  flex-basis: 100%;
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--destructive-ink);
`;

interface Props {
  /** (metricId, ref) pairs in this group — the user picks which to repoint. */
  items: DriftItem[];
  members: MetaMember[];
  membersLoading: boolean;
  onRepoint: (metricId: string, from: string, to: string) => Promise<void>;
}

interface Rect {
  left: number;
  width: number;
  /** Anchored from the top (open down) or the bottom (open up) — exactly one set. */
  top: number | null;
  bottom: number | null;
  /** Max height for the scrollable list so the menu always fits the viewport. */
  listMax: number;
}

export function RepointRefForm({ items, members, membersLoading, onRepoint }: Props): ReactElement {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [fromIdx, setFromIdx] = useState(0);
  const [to, setTo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = items[fromIdx] ?? items[0];

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q ? members.filter((m) => m.ref.toLowerCase().includes(q)) : members;
    return list.slice(0, 200);
  }, [members, filter]);

  // Anchor the portal menu under the trigger; recompute on open + on
  // scroll/resize so it tracks the field. Capture-phase scroll catches scrolls
  // in any ancestor (the resolve pane, the page).
  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const GAP = 6;
    const SEARCH_H = 46; // search box + its border
    const below = vh - r.bottom - GAP - 8;
    const above = r.top - GAP - 8;
    // Open upward only when below is cramped and above has more room.
    const openUp = below < 200 && above > below;
    const space = openUp ? above : below;
    const listMax = Math.max(120, Math.min(300, space - SEARCH_H));
    setRect({
      left: r.left,
      width: r.width,
      top: openUp ? null : r.bottom + GAP,
      bottom: openUp ? vh - r.top + GAP : null,
      listMax,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  // Close on outside click (trigger + menu both excluded).
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function submit() {
    if (!to) {
      setError('Pick a target member first.');
      return;
    }
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      await onRepoint(selected.metricId, selected.ref, to);
      // success → parent refetch removes this group; nothing else to do.
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Form>
      <Col $grow>
        <FieldLabel>From (current, unresolved)</FieldLabel>
        {items.length > 1 ? (
          <FromSelect value={fromIdx} onChange={(e) => setFromIdx(Number(e.target.value))}>
            {items.map((it, i) => (
              <option key={`${it.metricId}:${it.ref}`} value={i}>
                {it.metricId} · {it.ref}
              </option>
            ))}
          </FromSelect>
        ) : (
          <ReadonlyInput readOnly value={selected ? selected.ref : ''} />
        )}
      </Col>
      <Arrow aria-hidden>→</Arrow>
      <Col $grow>
        <FieldLabel>To (live /meta member)</FieldLabel>
        <SelectBox ref={triggerRef} type="button" $open={open} onClick={() => setOpen((v) => !v)}>
          <span style={to ? undefined : { color: 'var(--text-muted)' }}>
            {to || (membersLoading ? 'loading members…' : 'search members…')}
          </span>
          <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} aria-hidden />
        </SelectBox>
      </Col>
      <SubmitBtn type="button" disabled={submitting || !to} onClick={submit}>
        {submitting ? 'Repointing…' : 'Repoint'}
      </SubmitBtn>
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {open && rect
        ? createPortal(
            <Menu
              ref={menuRef}
              style={{
                left: rect.left,
                width: rect.width,
                ...(rect.top !== null ? { top: rect.top } : {}),
                ...(rect.bottom !== null ? { bottom: rect.bottom } : {}),
              }}
            >
              <Search>
                <input
                  autoFocus
                  placeholder="filter cube.member…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </Search>
              <List style={{ maxHeight: rect.listMax }}>
                {filtered.length === 0 ? (
                  <Item $sel={false} as="li" style={{ cursor: 'default', color: 'var(--text-muted)' }}>
                    {membersLoading ? 'loading members…' : 'no members match'}
                  </Item>
                ) : (
                  filtered.map((m) => (
                    <Item
                      key={m.ref}
                      $sel={m.ref === to}
                      onClick={() => {
                        setTo(m.ref);
                        setOpen(false);
                      }}
                    >
                      {m.ref}
                      <Tag $kind={m.kind}>{m.kind === 'measure' ? 'measure' : 'dimension'}</Tag>
                    </Item>
                  ))
                )}
              </List>
            </Menu>,
            document.body,
          )
        : null}
    </Form>
  );
}
