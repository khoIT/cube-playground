/*
 * Theme contract for @cube-dev/ui-kit Root component.
 * Bridges CSS custom-properties from tokens.css into UI-kit's styles prop.
 *
 * QUERY_BUILDER_COLOR_TOKENS (from src/QueryBuilderV2/color-tokens.ts) supplies
 * Less variables; we merge them at call site so QBv2 internal hues stay intact.
 */
export const rootStyles = {
  height: 'min 100vh',
  display: 'grid',
  gridTemplateRows: 'min-content 1fr',
  fontFamily: 'var(--font-sans)',
  color: 'var(--text-primary)',
  background: 'var(--bg-app)',

  '--primary-color': 'var(--brand)',
  '--primary-color-hover': 'var(--brand-hover)',
  '--primary-text-color': 'var(--text-on-brand)',
  '--purple-color': 'var(--brand)',
  '--purple-text-color': 'var(--brand-hover)',
} as const;
