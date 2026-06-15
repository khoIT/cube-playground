/**
 * SidebarItem — single nav row with icon + label + optional caret.
 * Active state (inset rounded pill):
 *   - top-level: soft brand pill + brand-tinted icon + semi-bold brand text
 *   - sub-row (indent): soft brand pill (no left bar) so it doesn't clash with tree-line
 *   - collapsed: icon-only with hover tooltip
 * Rows live inside the nav's 8px side gutter; the pill is inset with an 8px radius.
 */
import React from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { T, Icon, type LucideIcon } from '../theme';
import { useRouteActive } from './use-route-active';

interface SidebarItemProps {
  icon?: LucideIcon;
  /** Override the icon color (e.g. a brand-orange accent). Defaults to the
   *  standard active/inactive nav grey. Applies to both expanded and collapsed. */
  iconColor?: string;
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
  /** Header-link half of a split section row. The parent wrapper paints the
   *  shared row hover/active background, so this row paints none of its own and
   *  shows no caret (the separate toggle button owns the caret). */
  headerLink?: boolean;
  /** Never render the active highlight even when the route matches. Used by
   *  "See all…" / empty-state rows, which point at the section's own landing
   *  route and would otherwise light up whenever that section is active. */
  neverActive?: boolean;
}

export function SidebarItem({
  icon, iconColor, label, to, matchPrefix, expandable, expanded,
  primary, onClick, indent, muted, trailing, trailingShowOnHover, collapsed,
  headerLink, neverActive,
}: SidebarItemProps) {
  const isActive = useRouteActive(to, matchPrefix) && !neverActive;

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = React.useState(false);
  React.useEffect(() => {
    if (isActive) {
      scrollRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isActive]);

  if (collapsed && !indent) {
    const inner = (
      <CollapsedRow icon={icon} iconColor={iconColor} label={label} primary={primary} isActive={isActive} />
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

  // Active rows wear a soft brand pill; the resting background carries it so
  // hover never overrides an active row. Header-link rows paint nothing — the
  // parent section wrapper owns the shared header pill (link half + caret half).
  const restBg = isActive && !headerLink ? 'var(--shell-nav-active)' : 'transparent';
  const inner = (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        // Children sit to the RIGHT of the tree spine (drawn at x=18): both
        // icon'd sub-rows and text-only recents indent their content to 28px so
        // the label clears the spine instead of straddling it.
        padding: indent ? '6px 10px 6px 28px' : '7px 10px',
        position: 'relative',
        cursor: 'pointer',
        userSelect: 'none',
        borderRadius: 8,
        background: restBg,
        transition: 'background .12s',
      }}
      onMouseEnter={e => {
        setHovered(true);
        // Every navigable row gets a hover pill (children included). Active rows
        // keep their brand pill; header-link rows defer to the parent wrapper.
        if (!headerLink && !isActive) e.currentTarget.style.background = 'var(--shell-nav-hover)';
      }}
      onMouseLeave={e => {
        setHovered(false);
        if (!headerLink && !isActive) e.currentTarget.style.background = restBg;
      }}
    >
      {primary
        ? <Icon icon={Plus} size={14} color={'var(--shell-text-emphasis)'} />
        : icon
          ? <Icon icon={icon} size={indent ? 12 : 16} color={iconColor ?? (isActive ? 'var(--shell-brand)' : 'var(--shell-text-muted)')} />
          : <span style={{ width: indent ? 12 : 16 }} />
      }

      <span style={{
        flex: 1, minWidth: 0,
        fontFamily: T.fSans,
        fontSize: muted ? 12 : 13,
        fontWeight: isActive ? 600 : primary ? 600 : 500,
        // Active rows read brand; muted recents brighten on hover; other child
        // rows brighten muted → foreground on hover; top-level rows stay fixed.
        color: isActive
          ? 'var(--shell-brand)'
          : muted
            ? (hovered ? 'var(--shell-text-emphasis)' : 'var(--shell-text-subtle)')
            : (indent && hovered ? 'var(--shell-text-strong)' : 'var(--shell-text-emphasis)'),
        transition: 'color .12s',
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
        <Icon icon={expanded ? ChevronDown : ChevronRight} size={12} color={'var(--shell-text-faint)'} />
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
  iconColor?: string;
  label: string;
  primary?: boolean;
  isActive: boolean;
}

function CollapsedRow({ icon, iconColor, label, primary, isActive }: CollapsedRowProps) {
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
        borderRadius: 8,
        background: isActive
          ? 'var(--shell-nav-active)'
          : hover ? 'var(--shell-nav-hover)' : 'transparent',
        cursor: 'pointer',
        transition: 'background .12s',
      }}
    >
      {primary
        ? <Icon icon={Plus} size={16} color={'var(--shell-text-emphasis)'} />
        : icon
          ? <Icon icon={icon} size={18} color={iconColor ?? (isActive ? 'var(--shell-brand)' : 'var(--shell-text-muted)')} />
          : null}
      {hover && tipPos && (
        <div
          style={{
            position: 'fixed', top: tipPos.top, left: tipPos.left,
            transform: 'translateY(-50%)',
            background: 'var(--shell-text)', color: '#fff',
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
