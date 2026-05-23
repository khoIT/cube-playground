/**
 * CollapseToggle — round chevron button at the sidebar's right seam.
 * Hidden by default; a thin invisible hit-strip straddles the seam and
 * fades the button in on hover. Click toggles 260↔60 modes.
 */
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { T, Icon } from '../theme';
import { setCollapsed } from './sidebar-collapsed-store';

interface CollapseToggleProps {
  collapsed: boolean;
}

const BUTTON_SIZE = 28;
const STRIP_WIDTH = 16;

export function CollapseToggle({ collapsed }: CollapseToggleProps) {
  const [hovered, setHovered] = React.useState(false);
  const [buttonHovered, setButtonHovered] = React.useState(false);

  const visible = hovered || buttonHovered;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        right: -STRIP_WIDTH / 2,
        width: STRIP_WIDTH,
        zIndex: 20,
        pointerEvents: 'auto',
      }}
    >
      <button
        type="button"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        onClick={() => setCollapsed(!collapsed)}
        onMouseEnter={() => setButtonHovered(true)}
        onMouseLeave={() => setButtonHovered(false)}
        style={{
          position: 'sticky',
          top: '50vh',
          marginLeft: (STRIP_WIDTH - BUTTON_SIZE) / 2,
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
          padding: 0,
          borderRadius: '50%',
          background: T.surface,
          border: `1px solid ${T.n200}`,
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          color: T.n700,
          cursor: 'pointer',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.15s ease, background 0.12s, color 0.12s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon icon={collapsed ? ChevronRight : ChevronLeft} size={14} />
      </button>
    </div>
  );
}
