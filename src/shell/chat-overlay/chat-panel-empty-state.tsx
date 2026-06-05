/**
 * ChatPanelEmptyState — shown in the panel when no session is active.
 * Displays 3 prompt suggestion chips; clicking a chip inserts the text
 * into the composer via the onSuggest callback.
 *
 * Chips are the top-3 of the per-(workspace, game) generated starter set,
 * falling back to a static trio while no generated set exists.
 */
import React from 'react';
import { T } from '../theme';
import { useGeneratedStarters } from '../../pages/Chat/library/use-generated-starters';

const FALLBACK_SUGGESTIONS = [
  'Show daily revenue last 7 days',
  'Compare ARPDAU month-over-month',
  'Top 10 campaigns by ROAS',
] as const;

interface ChatPanelEmptyStateProps {
  onSuggest: (text: string) => void;
}

export function ChatPanelEmptyState({ onSuggest }: ChatPanelEmptyStateProps) {
  const { starters, source } = useGeneratedStarters();
  const suggestions =
    source === 'static-fallback'
      ? FALLBACK_SUGGESTIONS
      : starters.slice(0, 3).map((s) => s.text);
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        gap: 12,
      }}
    >
      <h2
        style={{
          fontFamily: T.fSans,
          fontWeight: 600,
          fontSize: 14,
          color: T.n700,
          margin: 0,
          textAlign: 'center',
        }}
      >
        Ask anything about your data
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 280 }}>
        {suggestions.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => onSuggest(text)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: `1px solid ${T.n200}`,
              background: T.surface,
              fontFamily: T.fSans,
              fontSize: 12,
              color: T.n700,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.12s, border-color 0.12s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = T.surfaceSubtle;
              (e.currentTarget as HTMLButtonElement).style.borderColor = T.n300;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = T.surface;
              (e.currentTarget as HTMLButtonElement).style.borderColor = T.n200;
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
