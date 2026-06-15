/**
 * SidebarEdgeToggle — the flush 1px seam between the sidebar and main content.
 * Rendered as a flex child BETWEEN <Sidebar/> and <main/> in the shell layout.
 *
 * At rest the seam is a 1px transparent line (invisible). On hover the line
 * tints and a 36px circle appears straddling the seam at the cursor's Y
 * position, sliding with the mouse. The circle holds a ChevronLeft (expanded)
 * or ChevronRight (collapsed) and a 400ms-delayed tooltip on its right.
 * Clicking anywhere along the seam toggles the 260↔60px sidebar.
 */
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { T, Icon } from '../theme';
import { setCollapsed } from './sidebar-collapsed-store';

interface SidebarEdgeToggleProps {
  collapsed: boolean;
}

const CIRCLE = 36;
const TOOLTIP_DELAY = 400;

export function SidebarEdgeToggle({ collapsed }: SidebarEdgeToggleProps) {
  const [hovered, setHovered] = React.useState(false);
  // null = circle parks at vertical center; a number tracks the cursor Y.
  const [mouseY, setMouseY] = React.useState<number | null>(null);
  const [tipVisible, setTipVisible] = React.useState(false);
  const tipTimer = React.useRef<number | null>(null);

  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';

  const clearTip = React.useCallback(() => {
    if (tipTimer.current != null) {
      window.clearTimeout(tipTimer.current);
      tipTimer.current = null;
    }
    setTipVisible(false);
  }, []);

  React.useEffect(() => clearTip, [clearTip]);

  const handleEnter = () => {
    setHovered(true);
    // Delay the tooltip so a quick mouse pass-through doesn't flash it.
    tipTimer.current = window.setTimeout(() => setTipVisible(true), TOOLTIP_DELAY);
  };

  const handleLeave = () => {
    setHovered(false);
    setMouseY(null); // ease the circle back to center
    clearTip();
  };

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const top = e.currentTarget.getBoundingClientRect().top;
    setMouseY(e.clientY - top);
  };

  const toggle = () => setCollapsed(!collapsed);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onMouseMove={handleMove}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
      style={{
        position: 'relative',
        width: 1,
        flexShrink: 0,
        alignSelf: 'stretch',
        cursor: 'pointer',
        zIndex: 20,
        background: hovered ? T.n200 : 'transparent',
        transition: 'background 0.12s',
      }}
    >
      {/* Widened invisible hit-strip so the 1px seam is easy to hover. */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: -8, right: -8 }} />

      {/* Floating circle indicator — straddles the seam, tracks cursor Y. */}
      <div
        style={{
          position: 'absolute',
          width: CIRCLE,
          height: CIRCLE,
          right: -CIRCLE / 2,
          top: mouseY ?? '50%',
          transform: 'translateY(-50%)',
          borderRadius: '50%',
          background: T.surface,
          border: `1px solid ${T.n200}`,
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: T.n700,
          opacity: hovered ? 1 : 0,
          pointerEvents: 'none',
          transition: 'opacity 0.15s ease, top 0.05s linear',
        }}
      >
        <Icon icon={collapsed ? ChevronRight : ChevronLeft} size={18} />

        {tipVisible && (
          <div
            style={{
              position: 'absolute',
              left: CIRCLE + 8,
              top: '50%',
              transform: 'translateY(-50%)',
              background: T.n900,
              color: '#fff',
              padding: '4px 8px',
              borderRadius: 4,
              fontFamily: T.fSans,
              fontSize: 11,
              fontWeight: 500,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            {label}
          </div>
        )}
      </div>
    </div>
  );
}
