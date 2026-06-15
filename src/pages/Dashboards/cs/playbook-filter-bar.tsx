/**
 * Playbook filter bar — the primary triage filter for the By-Playbook lens.
 *
 * A prominent bordered bar showing the selected playbooks as removable chips plus
 * an "Add / change" dropdown (searchable, checkbox multi-select, stays open while
 * toggling, closes on outside click). At least one playbook stays selected.
 *
 * Source: useCarePlaybooks(gameId). Blocked/unavailable playbooks are excluded —
 * they have no queue to filter. Options are grouped by NHÓM (registry group).
 *
 * Outside-click uses a `mousedown` document listener gated on `.closest()` of the
 * dropdown root — NOT a full-screen backdrop (a backdrop intercepts clicks on the
 * chips themselves). Tokens only; mirrors the ledger control styling.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X, Search, Check } from 'lucide-react';
import { useCarePlaybooks, type ResolvedPlaybook, type PlaybookNhom } from './use-care-playbooks';

const NHOM_LABEL: Record<PlaybookNhom, string> = {
  1: 'NHÓM 1 · Payment',
  2: 'NHÓM 2 · In-game',
  3: 'NHÓM 3 · Churn',
  4: 'NHÓM 4 · Event',
};

interface PlaybookFilterBarProps {
  gameId: string;
  /** Currently-selected playbook ids (URL is the source of truth). [] = all. */
  selected: string[];
  /** Toggle one id in/out of the selection. Empty selection means "all playbooks". */
  onToggle: (id: string) => void;
}

export function PlaybookFilterBar({ gameId, selected, onToggle }: PlaybookFilterBarProps) {
  const { playbooks } = useCarePlaybooks(gameId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // Only playbooks with a real queue are filterable.
  const usable = useMemo(
    () => playbooks.filter((p) => p.availability !== 'unavailable'),
    [playbooks],
  );
  const byId = useMemo(() => new Map(usable.map((p) => [p.id, p])), [usable]);

  // Close on outside mousedown — gated on .closest() so chip clicks survive.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = usable.filter((p) => !q || p.name.toLowerCase().includes(q) || p.id.includes(q));
    const groups = new Map<PlaybookNhom, ResolvedPlaybook[]>();
    for (const p of match) {
      if (!groups.has(p.nhom)) groups.set(p.nhom, []);
      groups.get(p.nhom)!.push(p);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [usable, query]);

  return (
    <div
      ref={rootRef}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        padding: '10px 14px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-lg)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
        Playbooks
      </span>

      {/* Empty selection = every playbook (no server filter). */}
      {selected.length === 0 && (
        <span
          style={{
            display: 'inline-flex', alignItems: 'center',
            fontSize: 12, fontWeight: 600, padding: '4px 11px',
            borderRadius: 'var(--radius-full)', background: 'var(--bg-muted)',
            color: 'var(--text-secondary)', whiteSpace: 'nowrap',
          }}
        >
          All playbooks
        </span>
      )}

      {/* Selected chips — each removable; removing the last returns to "all". */}
      {selected.map((id) => {
        const pb = byId.get(id);
        return (
          <span
            key={id}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 600, padding: '4px 6px 4px 10px',
              borderRadius: 'var(--radius-full)', background: 'var(--brand-soft)',
              color: 'var(--brand-hover)', whiteSpace: 'nowrap',
            }}
          >
            {pb?.name ?? id}
            <button
              type="button"
              aria-label={`Remove ${pb?.name ?? id}`}
              onClick={() => onToggle(id)}
              title="Remove"
              style={{
                display: 'inline-flex', border: 0, background: 'transparent', padding: 1,
                borderRadius: 'var(--radius-full)', cursor: 'pointer',
                color: 'inherit', opacity: 0.7,
              }}
            >
              <X size={13} />
            </button>
          </span>
        );
      })}

      {/* Add / change trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
          color: 'var(--text-secondary)', background: 'var(--bg-muted)',
          border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-full)',
          padding: '4px 11px', cursor: 'pointer',
        }}
      >
        Add / change <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .12s' }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 30,
            width: 'min(420px, 90vw)', maxHeight: 360, overflowY: 'auto',
            background: 'var(--bg-card)', border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg, var(--shadow-sm))',
            padding: 8,
          }}
        >
          {/* Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px', marginBottom: 6, background: 'var(--bg-muted)', borderRadius: 'var(--radius-md)' }}>
            <Search size={14} style={{ color: 'var(--text-muted)' }} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search playbooks…"
              style={{
                flex: 1, border: 0, outline: 'none', background: 'transparent',
                fontSize: 13, fontFamily: 'var(--font-sans)', color: 'var(--text-primary)',
              }}
            />
          </div>

          {grouped.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              No playbooks match “{query}”.
            </div>
          )}

          {grouped.map(([nhom, rows]) => (
            <div key={nhom} style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', padding: '6px 9px 3px' }}>
                {NHOM_LABEL[nhom]}
              </div>
              {rows.map((p) => {
                const on = selected.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onToggle(p.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                      textAlign: 'left', border: 0, background: on ? 'var(--brand-soft)' : 'transparent',
                      borderRadius: 'var(--radius-md)', padding: '7px 9px', cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    <span
                      style={{
                        width: 16, height: 16, flexShrink: 0, borderRadius: 4,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        border: `1.5px solid ${on ? 'var(--brand)' : 'var(--border-strong)'}`,
                        background: on ? 'var(--brand)' : 'transparent', color: 'var(--text-on-brand)',
                      }}
                    >
                      {on && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span style={{ flex: 1, fontSize: 12.5, fontWeight: on ? 600 : 500, color: 'var(--text-primary)' }}>
                      {p.name}
                    </span>
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{p.id}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
