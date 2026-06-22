/**
 * Whale glyph for the "Whales" headline KPI. lucide-react ships no whale, and a
 * literal whale reads far livelier than the generic Coins glyph the icon mapper
 * otherwise falls back to. Filled silhouette (not stroke) so it stays legible at
 * the 16px KPI size; `currentColor` + a lucide-matching `size` prop let it drop
 * into resolveKpiIcon exactly like a lucide icon and inherit the card's ink.
 */

import { ReactElement } from 'react';

export function WhaleIcon({ size = 16 }: { size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      role="img"
      focusable="false"
    >
      {/* water spout above the head */}
      <path d="M6.5 6.4c0-1.1.4-1.6.4-2.7" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      <path d="M4.7 4.4 4 3.6" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      <path d="M8.4 4.4 9 3.6" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      {/* body + forked fluke tail */}
      <path
        d="M2.5 13C2.5 9.4 5.4 6.7 9.1 6.7C12.5 6.7 14.5 9 16 11L22 8L18.5 13L22 18L16 15C14.5 17 12.5 19.3 9.1 19.3C5.4 19.3 2.5 16.6 2.5 13Z"
        fill="currentColor"
      />
      {/* eye — punched in the card surface so it reads on the filled body */}
      <circle cx="6.8" cy="12.4" r="1" style={{ fill: 'var(--bg-card)' }} />
    </svg>
  );
}
