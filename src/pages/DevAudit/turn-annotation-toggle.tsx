/**
 * TurnAnnotationToggle — star, flag dropdown, and note field for a turn header.
 *
 * Renders inline in the assistant turn header. All mutations are optimistic:
 * UI updates immediately, request fires in background.
 *
 * Props:
 *   turnId   — the turn to annotate
 *   initial  — annotation loaded from parent turn detail (null = none yet)
 */

import React, { useState } from 'react';
import { T } from '../../shell/theme';
import { useTurnAnnotation, useSetTurnAnnotation } from './use-turn-annotation';
import type { TurnAnnotation, AnnotationFlag } from './use-debug-api-types';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const S = {
  wrap: {
    display: 'flex', alignItems: 'center', gap: 6,
  } as React.CSSProperties,
  starBtn: (starred: boolean): React.CSSProperties => ({
    background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
    fontSize: 15, lineHeight: 1,
    color: starred ? 'var(--shell-warning)' : 'var(--shell-border-strong)',
    transition: 'color 0.1s',
  }),
  flagSelect: {
    fontSize: 11, padding: '1px 4px', borderRadius: 4,
    border: `1px solid var(--shell-border-strong)`, background: 'var(--surface-raised)', color: 'var(--shell-text-secondary)',
    cursor: 'pointer', fontFamily: 'inherit',
  } as React.CSSProperties,
  noteToggle: {
    fontSize: 10, color: 'var(--shell-text-faint)', background: 'none', border: 'none',
    cursor: 'pointer', padding: '0 2px', textDecoration: 'underline',
  } as React.CSSProperties,
  noteWrap: {
    marginTop: 4, display: 'flex', flexDirection: 'column' as const, gap: 4,
  } as React.CSSProperties,
  noteArea: {
    fontSize: 11, fontFamily: 'inherit', padding: '4px 6px',
    border: `1px solid var(--shell-border-strong)`, borderRadius: 4,
    background: 'var(--surface-raised)', color: 'var(--shell-text-emphasis)', resize: 'vertical' as const,
    width: '100%', boxSizing: 'border-box' as const, minHeight: 48,
  } as React.CSSProperties,
  saveBtn: {
    fontSize: 11, padding: '2px 8px', borderRadius: 4,
    border: `1px solid var(--shell-border-strong)`, background: 'var(--surface-subtle)', color: 'var(--shell-text-secondary)',
    cursor: 'pointer', alignSelf: 'flex-end' as const,
  } as React.CSSProperties,
};

const FLAG_OPTIONS: Array<{ value: AnnotationFlag; label: string }> = [
  { value: null,        label: '— no flag' },
  { value: 'bug',       label: '🐛 bug' },
  { value: 'important', label: '❗ important' },
  { value: 'review',    label: '👁 review' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TurnAnnotationToggleProps {
  turnId: string;
  initial: TurnAnnotation | null;
}

export function TurnAnnotationToggle({ turnId, initial }: TurnAnnotationToggleProps) {
  const { annotation, setOptimistic } = useTurnAnnotation(initial);
  const { set: saveAnnotation } = useSetTurnAnnotation();
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState(initial?.note ?? '');

  const starred = annotation?.starred ?? false;
  const flag = annotation?.flag ?? null;

  async function toggleStar() {
    // Optimistic: flip immediately
    const next: TurnAnnotation = {
      turnId,
      starred: !starred,
      flag: annotation?.flag ?? null,
      note: annotation?.note ?? null,
      updatedAt: Date.now(),
    };
    setOptimistic(next);
    try {
      const saved = await saveAnnotation(turnId, { starred: !starred });
      setOptimistic(saved);
    } catch {
      // rollback
      setOptimistic(annotation);
    }
  }

  async function changeFlag(e: React.ChangeEvent<HTMLSelectElement>) {
    const newFlag = (e.target.value === '' ? null : e.target.value) as AnnotationFlag;
    const next: TurnAnnotation = {
      turnId,
      starred: annotation?.starred ?? false,
      flag: newFlag,
      note: annotation?.note ?? null,
      updatedAt: Date.now(),
    };
    setOptimistic(next);
    try {
      const saved = await saveAnnotation(turnId, { flag: newFlag });
      setOptimistic(saved);
    } catch {
      setOptimistic(annotation);
    }
  }

  async function saveNote() {
    const next: TurnAnnotation = {
      turnId,
      starred: annotation?.starred ?? false,
      flag: annotation?.flag ?? null,
      note: noteText || null,
      updatedAt: Date.now(),
    };
    setOptimistic(next);
    try {
      const saved = await saveAnnotation(turnId, { note: noteText || null });
      setOptimistic(saved);
      setNoteOpen(false);
    } catch {
      setOptimistic(annotation);
    }
  }

  return (
    <div>
      <div style={S.wrap} onClick={(e) => e.stopPropagation()}>
        {/* Star toggle */}
        <button
          style={S.starBtn(starred)}
          onClick={toggleStar}
          aria-label={starred ? 'Unstar turn' : 'Star turn'}
          title={starred ? 'Starred — click to unstar' : 'Click to star'}
          data-testid="star-toggle"
        >
          {starred ? '★' : '☆'}
        </button>

        {/* Flag dropdown */}
        <select
          style={S.flagSelect}
          value={flag ?? ''}
          onChange={changeFlag}
          aria-label="Flag turn"
          data-testid="flag-select"
        >
          {FLAG_OPTIONS.map((o) => (
            <option key={o.value ?? ''} value={o.value ?? ''}>{o.label}</option>
          ))}
        </select>

        {/* Note toggle */}
        <button
          style={S.noteToggle}
          onClick={() => { setNoteOpen((v) => !v); setNoteText(annotation?.note ?? ''); }}
          data-testid="note-toggle"
        >
          {noteOpen ? 'close note' : annotation?.note ? 'edit note' : 'add note'}
        </button>
      </div>

      {/* Inline note editor */}
      {noteOpen && (
        <div style={S.noteWrap} onClick={(e) => e.stopPropagation()}>
          <textarea
            style={S.noteArea}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note… (max 1 KB)"
            maxLength={1024}
            data-testid="note-textarea"
          />
          <button style={S.saveBtn} onClick={saveNote} data-testid="note-save">
            Save note
          </button>
        </div>
      )}
    </div>
  );
}
