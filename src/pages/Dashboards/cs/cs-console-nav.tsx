/**
 * CS console step-nav — a shared wayfinding bar across the three CS Care surfaces:
 *
 *   CS Monitor  →  Case Ledger / Queue  →  Member-360 Care
 *
 * Rendered at the top of each page so an analyst can travel between them in one
 * click. Steps before the current one read as "done" (check), the current one is a
 * filled pill with a numbered badge, and steps after are muted. The Member-360 step
 * has no generic destination (it needs a specific VIP), so it's only interactive
 * when it IS the current page.
 *
 * Tokens only. The active pill uses the theme-aware --text-primary / --bg-card pair
 * so it reads as a dark pill in light mode and an inverse pill in dark mode.
 */

import { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight } from 'lucide-react';

export type CsConsoleStep = 'monitor' | 'queue' | 'member';

interface StepDef {
  key: CsConsoleStep;
  label: string;
}

const STEPS: StepDef[] = [
  { key: 'monitor', label: 'CS Monitor' },
  { key: 'queue', label: 'Case Ledger / Queue' },
  { key: 'member', label: 'Member-360 Care' },
];

interface CsConsoleNavProps {
  current: CsConsoleStep;
  /** Active game — preserved across the monitor/queue links via ?game=. */
  gameId?: string;
  /**
   * `page` (default) renders the bar inside a page body with bottom spacing.
   * `topbar` renders it inline in the global Topbar — no bottom margin, fills
   * the leading slot, never wraps.
   */
  variant?: 'page' | 'topbar';
}

/** Destination for a step, or null when it has no generic target (member step). */
function hrefFor(key: CsConsoleStep, gameId?: string): string | null {
  const g = gameId ? `?game=${encodeURIComponent(gameId)}` : '';
  if (key === 'monitor') return `/dashboards/cs${g}`;
  if (key === 'queue') return `/dashboards/cs/queue${g}`;
  return null;
}

const NUMBER_CIRCLE: React.CSSProperties = {
  width: 18,
  height: 18,
  flexShrink: 0,
  borderRadius: 'var(--radius-full)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};

function StepBadge({ state, index }: { state: 'done' | 'active' | 'todo'; index: number }) {
  if (state === 'done') {
    return (
      <span style={{ ...NUMBER_CIRCLE, background: 'var(--success-soft)', color: 'var(--success-ink)' }}>
        <Check size={11} strokeWidth={3} />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span style={{ ...NUMBER_CIRCLE, background: 'var(--brand)', color: 'var(--text-on-brand)' }}>
        {index + 1}
      </span>
    );
  }
  return (
    <span
      style={{
        ...NUMBER_CIRCLE,
        background: 'transparent',
        color: 'var(--text-muted)',
        border: '1.5px solid var(--border-strong)',
      }}
    >
      {index + 1}
    </span>
  );
}

export function CsConsoleNav({ current, gameId, variant = 'page' }: CsConsoleNavProps): ReactElement {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  const inTopbar = variant === 'topbar';

  return (
    <nav
      aria-label="CS console"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: inTopbar ? 'nowrap' : 'wrap',
        gap: 8,
        marginBottom: inTopbar ? 0 : 18,
        minWidth: 0,
        flex: inTopbar ? 1 : undefined,
        overflow: inTopbar ? 'hidden' : undefined,
        fontFamily: 'var(--font-sans)',
      }}
    >
      {STEPS.map((step, i) => {
        const state: 'done' | 'active' | 'todo' = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'todo';
        const href = hrefFor(step.key, gameId);
        const interactive = state !== 'active' && href != null;

        const labelColor =
          state === 'active' ? 'var(--bg-card)' : state === 'done' ? 'var(--text-secondary)' : 'var(--text-muted)';

        const inner = (
          <>
            <StepBadge state={state} index={i} />
            <span style={{ fontSize: 12.5, fontWeight: state === 'active' ? 700 : 600, color: labelColor }}>
              {step.label}
            </span>
          </>
        );

        const baseStyle: React.CSSProperties = {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: state === 'active' ? '5px 13px 5px 7px' : '5px 6px',
          borderRadius: 'var(--radius-full)',
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          background: state === 'active' ? 'var(--text-primary)' : 'transparent',
          cursor: interactive ? 'pointer' : 'default',
          opacity: state === 'todo' && !interactive ? 0.65 : 1,
          transition: 'background 0.12s',
        };

        const node = interactive ? (
          <Link key={step.key} to={href as string} style={baseStyle} title={`Go to ${step.label}`}>
            {inner}
          </Link>
        ) : (
          <span key={step.key} style={baseStyle} aria-current={state === 'active' ? 'page' : undefined}>
            {inner}
          </span>
        );

        return (
          <span key={`${step.key}-wrap`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {node}
            {i < STEPS.length - 1 && <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} aria-hidden />}
          </span>
        );
      })}
    </nav>
  );
}
