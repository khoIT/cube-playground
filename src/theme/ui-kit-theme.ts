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

  /*
   * Make tasty's `fill="#white"` theme-aware. tasty compiles to
   * `var(--white-color, ...)`; @cube-dev/ui-kit Root injects literal white.
   * Pointing it at --bg-card means `#white` follows the theme tokens.
   */
  '--white-color':     'var(--bg-card)',
  '--white-color-rgb': 'var(--bg-card-rgb)',

  /*
   * Legacy `#dark`/`#dark-01`...`#dark-05` tokens used widely by ui-kit and
   * QueryBuilderV2 (Title, Paragraph, CubeButton text, etc.). Pin them to
   * theme-aware text tokens so dark mode inherits a dark-text reversal
   * without having to touch every component.
   */
  '--dark-color':         'var(--text-primary)',
  '--dark-color-rgb':     'var(--text-primary-rgb)',
  '--dark-01-color':      'var(--text-primary)',
  '--dark-01-color-rgb':  'var(--text-primary-rgb)',
  '--dark-02-color':      'var(--text-secondary)',
  '--dark-02-color-rgb':  'var(--text-secondary-rgb)',
  '--dark-03-color':      'var(--text-muted)',
  '--dark-03-color-rgb':  'var(--text-muted-rgb)',
  '--dark-04-color':      'var(--text-muted)',
  '--dark-04-color-rgb':  'var(--text-muted-rgb)',
  '--dark-05-color':      'var(--border-strong)',

  '--light-color':        'var(--bg-muted)',
  '--gray-color':         'var(--bg-muted)',
  '--text-color':         'var(--text-primary)',
  '--heading-color':      'var(--text-primary)',
} as const;
