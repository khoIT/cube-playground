/**
 * EventEditor — inline add / edit form for chart annotations.
 *
 * Renders a compact card form. When `existing` is provided the form pre-fills
 * for editing; otherwise it renders blank for creating a new annotation.
 * Calls onSave with the final input (caller decides create vs update).
 *
 * Token-only styling — no raw hex or px outside the spacing scale.
 */

import React, { useState } from 'react';
import type { ChartAnnotation, AnnotationType, CreateAnnotationInput } from '../../../../api/chart-annotations';

export interface EventEditorProps {
  game: string;
  existing?: ChartAnnotation;
  onSave: (input: CreateAnnotationInput) => Promise<void>;
  onCancel: () => void;
}

const TYPES: { value: AnnotationType; label: string }[] = [
  { value: 'patch',    label: 'Patch' },
  { value: 'event',   label: 'Event' },
  { value: 'campaign',label: 'Campaign' },
  { value: 'incident',label: 'Incident' },
];

const formCard: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-md)',
  padding: 16,
  fontFamily: 'var(--font-sans)',
};

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 4,
};

const input: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 10px',
  fontSize: 13,
  color: 'var(--text-primary)',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-sm)',
  fontFamily: 'var(--font-sans)',
  outline: 'none',
};

const row: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'flex-end' };

export function EventEditor({ game, existing, onSave, onCancel }: EventEditorProps) {
  const [type, setType] = useState<AnnotationType>(existing?.type ?? 'event');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [startsAt, setStartsAt] = useState(existing?.starts_at ?? '');
  const [endsAt, setEndsAt] = useState(existing?.ends_at ?? '');
  const [url, setUrl] = useState(existing?.url ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr('Title is required'); return; }
    if (!startsAt) { setErr('Start date is required'); return; }
    setErr('');
    setSaving(true);
    try {
      await onSave({
        game,
        type,
        title: title.trim(),
        starts_at: startsAt,
        ends_at: endsAt || null,
        url: url.trim() || null,
      });
    } catch (e2: unknown) {
      setErr((e2 as Error).message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={formCard}>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gap: 12 }}>
          {/* Type selector */}
          <div>
            <span style={label}>Type</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  style={{
                    padding: '4px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-card)',
                    cursor: 'pointer',
                    background: type === t.value ? 'var(--brand)' : 'transparent',
                    color: type === t.value ? 'var(--text-on-brand)' : 'var(--text-secondary)',
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label style={label}>Title</label>
            <input
              style={input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. v2.4.1 patch, Flash sale, Login outage"
              maxLength={120}
            />
          </div>

          {/* Dates */}
          <div style={row}>
            <div style={{ flex: 1 }}>
              <label style={label}>Start date</label>
              <input type="date" style={input} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>End date (optional)</label>
              <input type="date" style={input} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>

          {/* URL */}
          <div>
            <label style={label}>Reference URL (optional)</label>
            <input
              style={input}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              type="url"
            />
          </div>

          {err && (
            <div style={{ fontSize: 12, color: 'var(--destructive-ink)' }}>{err}</div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: '6px 16px',
                fontSize: 13,
                fontFamily: 'var(--font-sans)',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-sm)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '6px 16px',
                fontSize: 13,
                fontFamily: 'var(--font-sans)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--brand)',
                color: 'var(--text-on-brand)',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Saving…' : existing ? 'Update' : 'Add event'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
