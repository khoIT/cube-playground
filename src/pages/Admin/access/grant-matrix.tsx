/**
 * GrantMatrix — a titled checkbox list used for Workspaces / Games / Features.
 * Controlled: parent owns the selected set; this only renders + emits toggles.
 *
 * Scales to long lists (the prod workspace exposes ~65 games): a filter box
 * appears once the list passes a threshold, the rows scroll within a capped
 * height, a "selected / total" count is shown, and bulk Select-all/Clear act on
 * the CURRENTLY FILTERED rows so a search + select-all grants just the matches.
 */

import React, { useState } from 'react';

export interface GrantOption {
  id: string;
  label: string;
}

interface GrantMatrixProps {
  title: string;
  options: GrantOption[];
  selected: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  error: string | null;
  /** When provided, renders "All / None" bulk controls. Receives the ids of the
   *  currently-visible (filtered) rows so select-all respects an active search. */
  onSelectAll?: (ids: string[]) => void;
  onClear?: () => void;
}

// Show the filter box only once the list is long enough to warrant it; cap the
// scroll height so a 65-row list never pushes the Save button off-screen.
const SEARCH_THRESHOLD = 10;
const LIST_MAX_HEIGHT = 320;

export function GrantMatrix({
  title, options, selected, onToggle, onSave, saving, saved, error, onSelectAll, onClear,
}: GrantMatrixProps) {
  const [query, setQuery] = useState('');
  const showBulk = !!(onSelectAll || onClear) && options.length > 0;
  const showSearch = options.length > SEARCH_THRESHOLD;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.id.toLowerCase().includes(q) || o.label.toLowerCase().includes(q))
    : options;
  const selectedCount = options.reduce((n, o) => (selected.has(o.id) ? n + 1 : n), 0);

  return (
    <section
      style={{
        border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)',
        background: 'var(--bg-card)', overflow: 'hidden',
      }}
    >
      <header
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border-card)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
          {options.length > 0 && (
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {selectedCount}/{options.length} selected
            </span>
          )}
        </span>
        <button type="button" onClick={onSave} disabled={saving} style={saveBtn(saving)}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      {showSearch && (
        <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-card)' }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${title.toLowerCase()}…`}
            style={searchInput}
          />
        </div>
      )}

      {showBulk && (
        <div
          style={{
            display: 'flex', gap: 6, padding: '8px 14px',
            borderBottom: '1px solid var(--border-card)',
          }}
        >
          {onSelectAll && (
            <button
              type="button"
              onClick={() => onSelectAll(filtered.map((o) => o.id))}
              style={bulkBtn}
            >
              {q ? 'Select matches' : 'Select all'}
            </button>
          )}
          {onClear && (
            <button type="button" onClick={onClear} style={bulkBtn}>Clear</button>
          )}
        </div>
      )}

      <div
        style={{
          padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8,
          maxHeight: LIST_MAX_HEIGHT, overflowY: 'auto',
        }}
      >
        {options.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nothing available.</span>
        )}
        {options.length > 0 && filtered.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No matches for “{query}”.</span>
        )}
        {filtered.map((opt) => (
          <label
            key={opt.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
              color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={selected.has(opt.id)}
              onChange={(e) => onToggle(opt.id, e.target.checked)}
              style={{ accentColor: 'var(--brand)', cursor: 'pointer' }}
            />
            {opt.label}
          </label>
        ))}
      </div>

      {(saved || error) && (
        <div
          style={{
            padding: '8px 14px', fontSize: 12, fontWeight: 500,
            borderTop: '1px solid var(--border-card)',
            background: error ? 'var(--destructive-soft)' : 'var(--success-soft)',
            color: error ? 'var(--destructive-ink)' : 'var(--success-ink)',
          }}
        >
          {error ?? 'Saved.'}
        </div>
      )}
    </section>
  );
}

function saveBtn(saving: boolean): React.CSSProperties {
  return {
    background: 'var(--brand)', color: 'var(--text-on-brand)', border: 'none',
    borderRadius: 'var(--radius-sm)', padding: '5px 14px',
    fontSize: 12, fontWeight: 600, cursor: saving ? 'default' : 'pointer',
    opacity: saving ? 0.6 : 1, fontFamily: 'var(--font-sans)',
  };
}

const bulkBtn: React.CSSProperties = {
  background: 'var(--bg-muted)', color: 'var(--text-secondary)',
  border: '1px solid var(--border-card)', borderRadius: 'var(--radius-sm)',
  padding: '3px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
};

const searchInput: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '6px 10px', fontSize: 13, fontFamily: 'var(--font-sans)',
  color: 'var(--text-primary)', background: 'var(--bg-app)',
  border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)',
};
