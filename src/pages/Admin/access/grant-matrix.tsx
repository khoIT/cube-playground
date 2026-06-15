/**
 * GrantMatrix — a titled checkbox list used for Workspaces / Games / Features.
 * Controlled: parent owns the selected set; this only renders + emits toggles.
 */

import React from 'react';

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
  /** When provided, renders "All / None" bulk controls under the header. */
  onSelectAll?: () => void;
  onClear?: () => void;
}

export function GrantMatrix({
  title, options, selected, onToggle, onSave, saving, saved, error, onSelectAll, onClear,
}: GrantMatrixProps) {
  const showBulk = !!(onSelectAll || onClear) && options.length > 0;
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
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
        <button type="button" onClick={onSave} disabled={saving} style={saveBtn(saving)}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      {showBulk && (
        <div
          style={{
            display: 'flex', gap: 6, padding: '8px 14px',
            borderBottom: '1px solid var(--border-card)',
          }}
        >
          {onSelectAll && (
            <button type="button" onClick={onSelectAll} style={bulkBtn}>Select all</button>
          )}
          {onClear && (
            <button type="button" onClick={onClear} style={bulkBtn}>Clear</button>
          )}
        </div>
      )}

      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nothing available.</span>
        )}
        {options.map((opt) => (
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
