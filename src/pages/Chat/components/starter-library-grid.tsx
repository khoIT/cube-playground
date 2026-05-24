/**
 * StarterLibraryGrid — 4×4 (desktop) / 1×16 (mobile) clickable card grid
 * of canonical business questions. Click → onPick(starter) which prefills
 * the chat composer (NO auto-submit; decision Q10).
 *
 * Filtering by persona happens in the parent (chat-empty-hero); this
 * component is a pure list renderer.
 */
import React from 'react';
import { T } from '../../../shell/theme';
import type { StarterQuestion } from '../library/starter-questions';

interface Props {
  starters: ReadonlyArray<StarterQuestion>;
  onPick: (starter: StarterQuestion) => void;
}

export function StarterLibraryGrid({ starters, onPick }: Props) {
  return (
    <div
      data-testid="starter-library-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 10,
        width: '100%',
        marginTop: 16,
      }}
    >
      {starters.map((s) => (
        <StarterCard key={s.id} starter={s} onPick={onPick} />
      ))}
    </div>
  );
}

function StarterCard({
  starter,
  onPick,
}: {
  starter: StarterQuestion;
  onPick: (s: StarterQuestion) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(starter)}
      data-starter-id={starter.id}
      style={{
        textAlign: 'left',
        padding: '12px 14px',
        border: `1px solid ${T.n300}`,
        borderRadius: 12,
        background: T.surface,
        cursor: 'pointer',
        fontFamily: T.fSans,
        fontSize: 13,
        color: T.n800,
        lineHeight: 1.45,
        transition: 'background 0.15s, border-color 0.15s, transform 0.05s',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = T.surfaceSubtle;
        el.style.borderColor = T.n400;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = T.surface;
        el.style.borderColor = T.n300;
      }}
      onMouseDown={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.98)';
      }}
      onMouseUp={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
      }}
    >
      <div style={{ fontWeight: 500 }}>{starter.text}</div>
      <div
        style={{
          marginTop: 6,
          fontSize: 11,
          color: T.n500,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {starter.personaTags.join(' · ')}
      </div>
    </button>
  );
}
