/**
 * SkeletonRow — shared loading skeleton components for DevAudit tabs.
 *
 * Three variants:
 *   <SkelRow />    — single list-row height (58px), used in SessionList, SearchResultList
 *   <SkelCard />   — card-sized box (96px), used in CacheDashboardHero grid
 *   <SkelText n={3} /> — N stacked gray bars, used in SessionDetail
 *
 * Respects prefers-reduced-motion: disables the sweep animation.
 *
 * Usage:
 *   import { SkelRow, SkelCard, SkelText } from './skeleton-row';
 */
import React from 'react';
import { T } from '../../shell/theme';

// ── keyframe injection (once per page) ────────────────────────────────────────

const STYLE_ID = 'dev-audit-skeleton-keyframes';

function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes skel-sweep {
      0%   { background-position: -200% 0; }
      100% { background-position:  200% 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .dev-audit-skel { animation: none !important; }
    }
  `;
  document.head.appendChild(style);
}

// Call once at module load (SPA — no SSR risk)
ensureKeyframes();

// ── shared sweep style ────────────────────────────────────────────────────────

const sweepStyle: React.CSSProperties = {
  background: `linear-gradient(90deg, var(--shell-bg-subtle) 25%, var(--shell-border) 50%, var(--shell-bg-subtle) 75%)`,
  backgroundSize: '200% 100%',
  animation: 'skel-sweep 1.6s ease-in-out infinite',
  borderRadius: 4,
};

// ── SkelRow ───────────────────────────────────────────────────────────────────

interface SkelRowProps {
  /** Height in px. Default 58. */
  height?: number;
  /** Horizontal margin in px. Default 12. */
  mx?: number;
}

export function SkelRow({ height = 58, mx = 12 }: SkelRowProps) {
  return (
    <div
      className="dev-audit-skel"
      style={{ ...sweepStyle, height, margin: `2px ${mx}px` }}
      aria-hidden="true"
    />
  );
}

// ── SkelCard ──────────────────────────────────────────────────────────────────

interface SkelCardProps {
  height?: number;
}

export function SkelCard({ height = 96 }: SkelCardProps) {
  return (
    <div
      className="dev-audit-skel"
      style={{ ...sweepStyle, height, borderRadius: 8 }}
      aria-hidden="true"
    />
  );
}

// ── SkelText ──────────────────────────────────────────────────────────────────

interface SkelTextProps {
  /** Number of text-bar rows. Default 3. */
  n?: number;
  /** Padding around the block in px. Default 16. */
  padding?: number;
}

export function SkelText({ n = 3, padding = 16 }: SkelTextProps) {
  return (
    <div style={{ padding, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: n }).map((_, i) => (
        <div
          key={i}
          className="dev-audit-skel"
          style={{
            ...sweepStyle,
            height: 12,
            // Last bar is shorter to suggest paragraph end
            width: i === n - 1 ? '60%' : '100%',
          }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
