/**
 * Shell font helpers + Icon + cx.
 *
 * Color tokens formerly exposed here (the `--hermes-*` proxy) have been migrated
 * onto the canonical semantic layer in `src/theme/tokens.css`: components read
 * `var(--shell-*)` / `var(--surface-*)` (the warm/cool two-tone frame) and
 * `var(--brand)` / `var(--bg-card)` / `var(--text-primary)` directly. `T` now
 * carries only the font stacks; `CHART` and `cx`/`Icon` are unchanged.
 */
import React from 'react';

export const T = {
  fDisp: '"League Gothic", "Inter", sans-serif',
  fSans: '"Inter", ui-sans-serif, system-ui, sans-serif',
  fMono: '"Geist Mono", "JetBrains Mono", ui-monospace, Menlo, monospace',
} as const;

// Ordered categorical chart-series palette. The canonical source of truth lives
// in src/theme/tokens.css as --chart-series-1..8; these literals MUST mirror it
// exactly. They stay literal hex (not var()) because the values feed recharts
// `fill`/`stroke` SVG presentation attributes, where CSS var() does not resolve.
// The Phase-4 inline-hex lint allowlists this single array for that reason.
export const CHART: string[] = [
  '#f05a22', '#3f8dff', '#059669', '#f59e0b', '#a855f7', '#ef4444', '#0891b2', '#db2777',
];

export const cx = (...args: Array<string | false | null | undefined>): string =>
  args.filter(Boolean).join(' ');

export type LucideIcon = React.ComponentType<{
  size?: string | number;
  color?: string;
  strokeWidth?: string | number;
  style?: React.CSSProperties;
  className?: string;
}>;

interface IconProps {
  icon: LucideIcon;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}

export const Icon = React.memo<IconProps>(({
  icon: IconComponent,
  size = 16,
  color,
  strokeWidth = 1.75,
  style,
}) => (
  <IconComponent
    size={size}
    color={color ?? 'currentColor'}
    strokeWidth={strokeWidth}
    style={{ flexShrink: 0, display: 'inline-block', ...style }}
  />
));
Icon.displayName = 'Icon';
