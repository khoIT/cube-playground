/**
 * SidebarItem — single nav row with icon + label + optional caret.
 * Active state:
 *   - top-level: 3px brand-tinted left bar + semi-bold text
 *   - sub-row (indent): box highlight (no left bar) so it doesn't clash with tree-line
 *   - collapsed: icon-only with hover tooltip
 */
import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { T, Icon, type LucideIcon } from '../theme';

interface SidebarItemProps {
  icon?: LucideIcon;
  label: string;
  /** Route to navigate to. Omit if it's an expand-only header (use onClick instead). */
  to?: string;
  /** Match these prefix(es) for active highlight; defaults to `to`. Pass an
   *  array when one section spans multiple route roots (e.g. plural list page
   *  + singular detail page). */
  matchPrefix?: string | string[];
  /** If provided, renders caret + makes row a button. */
  expandable?: boolean;
  expanded?: boolean;
  /** Show the leading "+ " glyph instead of the standard icon. */
  primary?: boolean;
  onClick?: () => void;
  /** Indented sub-row (recent items). */
  indent?: boolean;
  /** Smaller font for sub-rows. */
  muted?: boolean;
  /** Right-aligned trailing accessory (e.g. count badge). */
  trailing?: React.ReactNode;
  /** Only render `trailing` while the row is hovered (or focus-within).
   *  Used for hover-only kebab menus that should stay out of sight at rest. */
  trailingShowOnHover?: boolean;
  /** Sidebar collapsed mode — render icon-only. */
  collapsed?: boolean;
}

export function SidebarItem({
  icon, label, to, matchPrefix, expandable, expanded,
  primary, onClick, indent, muted, trailing, trailingShowOnHover, collapsed,
}: SidebarItemProps) {
  const location = useLocation();
  const prefixes: string[] = matchPrefix
    ? Array.isArray(matchPrefix) ? matchPrefix : [matchPrefix]
    : to ? [to] : [];
  const isActive = prefixes.some(p =>
    p === '/'
      ? location.pathname === '/'
      : location.pathname === p || location.pathname.startsWith(p + '/')
  );

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = React.useState(false);
  React.useEffect(() => {
    if (isActive) {
      scrollRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isActive]);

  if (collapsed && !indent) {
    const inner = (
      <CollapsedRow icon={icon} label={label} primary={primary} isActive={isActive} />
    );
    if (!to) {
      return <div ref={scrollRef} onClick={onClick} role="button" tabIndex={0}>{inner}</div>;
    }
    return (
      <div ref={scrollRef}>
        <NavLink to={to} onClick={onClick} style={{ textDecoration: 'none', display: 'block' }}>
          {inner}
        </NavLink>
      </div>
    );
  }

  if (collapsed && indent) return null;

  // Hover-trailing rows (chat recents kebab) overlay the trailing element
  // instead of placing it in flex flow — this keeps row height fixed and
  // swaps the title's truncation for a soft right-edge fade so the kebab
  // doesn't push `...` into the visible title.
  const hoverTrailingActive = !!trailing && !!trailingShowOnHover && hovered;
  // 64px fade width keeps the chat title clear of the 28px kebab button
  // plus its 4px right gutter — title visibly stops before the kebab area
  // instead of bleeding under it.
  const titleFade = hoverTrailingActive
    ? 'linear-gradient(to right, black 0, black calc(100% - 64px), transparent 100%)'
    : undefined;

  const inner = (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: indent ? '5px 12px 5px 16px' : '7px 12px',
        position: 'relative',
        cursor: 'pointer',
        userSelect: 'none',
        borderRadius: 0,
        background: indent && isActive ? 'rgba(0,0,0,0.05)' : 'transparent',
        transition: 'background .12s',
      }}
      onMouseEnter={e => {
        setHovered(true);
        if (!(indent && isActive)) e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
      }}
      onMouseLeave={e => {
        setHovered(false);
        e.currentTarget.style.background = indent && isActive ? 'rgba(0,0,0,0.05)' : 'transparent';
      }}
    >
      {isActive && !indent && (
        <div style={{
          position: 'absolute', left: 0, top: 4, bottom: 4, width: 3,
          background: T.brand, borderRadius: '0 2px 2px 0',
        }} />
      )}

      {primary
        ? <Icon icon={Plus} size={14} color={T.n800} />
        : icon
          ? <Icon icon={icon} size={indent ? 12 : 16} color={isActive ? T.n950 : T.n600} />
          : <span style={{ width: indent ? 12 : 16 }} />
      }

      <span style={{
        flex: 1, minWidth: 0,
        fontFamily: T.fSans,
        fontSize: muted ? 12 : 13,
        fontWeight: isActive ? 600 : primary ? 600 : 500,
        color: muted ? T.n500 : isActive ? T.n950 : T.n800,
        overflow: 'hidden',
        textOverflow: hoverTrailingActive ? 'clip' : 'ellipsis',
        whiteSpace: 'nowrap',
        maskImage: titleFade,
        WebkitMaskImage: titleFade,
      }}>{label}</span>

      {trailing && trailingShowOnHover ? (
        hovered && (
          <span style={{
            position: 'absolute', top: 0, bottom: 0, right: 4,
            display: 'flex', alignItems: 'center',
            pointerEvents: 'auto',
          }}>
            {trailing}
          </span>
        )
      ) : trailing}
      {expandable && (
        <Icon icon={expanded ? ChevronDown : ChevronRight} size={12} color={T.n400} />
      )}
    </div>
  );

  if (!to) {
    return <div ref={scrollRef} onClick={onClick} role="button" tabIndex={0}>{inner}</div>;
  }
  return (
    <div ref={scrollRef}>
      <NavLink to={to} onClick={onClick} style={{ textDecoration: 'none', display: 'block' }}>
        {inner}
      </NavLink>
    </div>
  );
}

interface CollapsedRowProps {
  icon?: LucideIcon;
  label: string;
  primary?: boolean;
  isActive: boolean;
}

function CollapsedRow({ icon, label, primary, isActive }: CollapsedRowProps) {
  const [hover, setHover] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const [tipPos, setTipPos] = React.useState<{ top: number; left: number } | null>(null);

  React.useEffect(() => {
    if (hover && ref.current) {
      const r = ref.current.getBoundingClientRect();
      setTipPos({ top: r.top + r.height / 2, left: r.right + 8 });
    } else {
      setTipPos(null);
    }
  }, [hover]);

  return (
    <div
      ref={ref}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 32, width: '100%',
        background: hover && !isActive ? 'rgba(0,0,0,0.04)' : 'transparent',
        cursor: 'pointer',
        transition: 'background .12s',
      }}
    >
      {isActive && (
        <div style={{
          position: 'absolute', left: 0, top: 4, bottom: 4, width: 3,
          background: T.brand, borderRadius: '0 2px 2px 0',
        }} />
      )}
      {primary
        ? <Icon icon={Plus} size={16} color={T.n800} />
        : icon
          ? <Icon icon={icon} size={18} color={isActive ? T.n950 : T.n600} />
          : null}
      {hover && tipPos && (
        <div
          style={{
            position: 'fixed', top: tipPos.top, left: tipPos.left,
            transform: 'translateY(-50%)',
            background: T.n900, color: '#fff',
            padding: '4px 8px', borderRadius: 4,
            fontFamily: T.fSans, fontSize: 11, fontWeight: 500,
            whiteSpace: 'nowrap', pointerEvents: 'none',
            zIndex: 50,
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
