/**
 * AskCubeFab — compact pill in the topbar that opens the chat panel.
 * Renders only when fabVisible=true (panel closed, off /chat). Hides while
 * the panel is open and reappears when the user closes it.
 *
 * Filename kept for git/test continuity; the surface is no longer floating.
 */
import React from 'react';
import { MessageCircle } from 'lucide-react';
import { T, Icon } from '../theme';

interface AskCubeFabProps {
  onClick: () => void;
  panelVisible?: boolean;
}

export function AskCubeFab({ onClick, panelVisible = false }: AskCubeFabProps) {
  return (
    <button
      type="button"
      data-testid="ask-cube-fab"
      aria-label="Ask Cube"
      aria-pressed={panelVisible}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 28,
        padding: '0 10px',
        borderRadius: 999,
        border: 'none',
        background: T.brand,
        color: '#fff',
        fontFamily: T.fSans,
        fontWeight: 600,
        fontSize: 12.5,
        lineHeight: 1,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        transition: 'background 120ms ease, transform 120ms ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = T.brandHover;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = T.brand;
      }}
    >
      <Icon icon={MessageCircle} size={13} color="#fff" />
      Ask Cube
    </button>
  );
}
