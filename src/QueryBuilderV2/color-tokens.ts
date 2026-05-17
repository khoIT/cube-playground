/*
 * QueryBuilderV2 member-type colour tokens. These are passed to the
 * @cube-dev/ui-kit Root as Less-style variables (`@name`); ui-kit forwards
 * each to its CSS-var counterpart (`--name-color`).
 *
 * Values reference theme-aware CSS vars defined in `src/theme/tokens.css` so
 * the same token set works for both light and dark mode without rewriting
 * the Root contract.
 */
export const QUERY_BUILDER_COLOR_TOKENS = {
  '@time-dimension-strong-color': 'var(--qb-time-strong)',
  '@time-dimension-text-color':   'var(--qb-time-text)',
  '@time-dimension-active-color': 'var(--qb-time-active)',
  '@time-dimension-hover-color':  'var(--qb-time-hover)',

  '@measure-strong-color':        'var(--qb-measure-strong)',
  '@measure-text-color':          'var(--qb-measure-text)',
  '@measure-active-color':        'var(--qb-measure-active)',
  '@measure-hover-color':         'var(--qb-measure-hover)',

  '@dimension-strong-color':      'var(--qb-dimension-strong)',
  '@dimension-text-color':        'var(--qb-dimension-text)',
  '@dimension-active-color':      'var(--qb-dimension-active)',
  '@dimension-hover-color':       'var(--qb-dimension-hover)',

  '@segment-strong-color':        'var(--qb-segment-strong)',
  '@segment-text-color':          'var(--qb-segment-text)',
  '@segment-active-color':        'var(--qb-segment-active)',
  '@segment-hover-color':         'var(--qb-segment-hover)',

  '@filter-strong-color':         'var(--qb-filter-strong)',
  '@filter-text-color':           'var(--qb-filter-text)',
  '@filter-active-color':         'var(--qb-filter-active)',
  '@filter-hover-color':          'var(--qb-filter-hover)',

  '@missing-strong-color':        'var(--qb-missing-strong)',
  '@missing-text-color':          'var(--qb-missing-text)',
  '@missing-active-color':        'var(--qb-missing-active)',
  '@missing-hover-color':         'var(--qb-missing-hover)',
};
