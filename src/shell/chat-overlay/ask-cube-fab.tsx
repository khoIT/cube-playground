/**
 * AskCubeFab — fixed bottom-right floating action button that opens the
 * chat panel. Rendered only when panelVisible=false and pageVisible=false.
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
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 42,
        padding: '0 18px',
        borderRadius: 999,
        border: 'none',
        background: T.n900,
        color: '#fff',
        fontFamily: T.fSans,
        fontWeight: 600,
        fontSize: 14,
        cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        transition: 'background 0.15s, transform 0.12s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = T.brand;
        (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = T.n900;
        (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
      }}
    >
      <Icon icon={MessageCircle} size={16} color="#fff" />
      Ask Cube
    </button>
  );
}
