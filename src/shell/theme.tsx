/**
 * Hermes shell tokens + Icon + cx helpers.
 *
 * The `T` proxy resolves to `var(--hermes-*)` so dark mode flips through
 * `html[data-theme="dark"]` in src/theme/tokens.css. Used exclusively by
 * components under `src/shell/*`. Cube's AntD/UI-kit surfaces continue to
 * read `--brand` / `--bg-card` / `--text-primary` from the same file.
 */
import React from 'react';

export const T = {
  n50:  'var(--hermes-n50)',
  n100: 'var(--hermes-n100)',
  n200: 'var(--hermes-n200)',
  n300: 'var(--hermes-n300)',
  n400: 'var(--hermes-n400)',
  n500: 'var(--hermes-n500)',
  n600: 'var(--hermes-n600)',
  n700: 'var(--hermes-n700)',
  n800: 'var(--hermes-n800)',
  n900: 'var(--hermes-n900)',
  n950: 'var(--hermes-n950)',

  brand:       'var(--hermes-brand)',
  brandHover:  'var(--hermes-brand-hover)',
  brandSoft:   'var(--hermes-brand-soft)',
  brandBorder: 'var(--hermes-brand-border)',

  red500:  'var(--hermes-red500)',
  red600:  'var(--hermes-red600)',
  redSoft: 'var(--hermes-red-soft)',

  blue500:  'var(--hermes-blue500)',
  blue600:  'var(--hermes-blue600)',
  blueSoft: 'var(--hermes-blue-soft)',

  green600:  'var(--hermes-green600)',
  greenSoft: 'var(--hermes-green-soft)',

  amber500:  'var(--hermes-amber500)',
  amberSoft: 'var(--hermes-amber-soft)',

  purple500:  'var(--hermes-purple500)',
  purpleSoft: 'var(--hermes-purple-soft)',

  surface:       'var(--hermes-surface)',
  surfaceMuted:  'var(--hermes-surface-muted)',
  surfaceSubtle: 'var(--hermes-surface-subtle)',

  shell:    'var(--hermes-shell)',
  sidebar:  'var(--hermes-sidebar)',
  topbar:   'var(--hermes-topbar)',

  fDisp: '"League Gothic", "Inter", sans-serif',
  fSans: '"Inter", ui-sans-serif, system-ui, sans-serif',
  fMono: '"Geist Mono", "JetBrains Mono", ui-monospace, Menlo, monospace',
} as const;

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
