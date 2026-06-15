/**
 * WorkspacePill — top-of-sidebar cube brand pill.
 * Click → /chat (workspace home).
 * Collapsed mode renders only the cube glyph centered.
 */
import React from 'react';
import { useHistory } from 'react-router-dom';
import { T } from '../theme';

interface WorkspacePillProps {
  collapsed?: boolean;
}

export function WorkspacePill({ collapsed }: WorkspacePillProps) {
  const history = useHistory();

  if (collapsed) {
    return (
      <button
        onClick={() => history.push('/chat')}
        title="Cube Playground"
        aria-label="Cube Playground"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '100%', height: 56, flexShrink: 0,
          background: 'transparent', border: 'none', cursor: 'pointer',
          borderRadius: 0,
        }}
      >
        <img
          src="/apple-touch-icon.png"
          alt=""
          aria-hidden
          style={{ width: 24, height: 24, display: 'block' }}
        />
      </button>
    );
  }

  return (
    <button
      onClick={() => history.push('/chat')}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%',
        height: 56, flexShrink: 0,
        padding: '0 12px',
        background: 'transparent', border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        borderRadius: 0,
      }}
    >
      <img
        src="/apple-touch-icon.png"
        alt=""
        aria-hidden
        style={{ width: 24, height: 24, display: 'block', flexShrink: 0 }}
      />
      <span style={{
        flex: 1, minWidth: 0,
        display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        <span style={{
          fontFamily: T.fSans, fontSize: 13, fontWeight: 600,
          color: T.n900, lineHeight: 1.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>Cube Playground</span>
        <span style={{
          fontFamily: T.fSans, fontSize: 10, fontWeight: 500,
          color: T.n500, lineHeight: 1.3, letterSpacing: '0.01em',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          Self-serve data exploration
        </span>
      </span>
    </button>
  );
}
