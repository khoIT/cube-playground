/**
 * Route manifest for the theme visual-regression gate.
 *
 * Each entry is captured in BOTH themes (light + dark) by `theme-routes.spec.ts`
 * and diffed against committed baselines. The gate's job is to catch color /
 * border / background / surface drift on chrome and component surfaces — NOT to
 * pin live data. So live-data regions (charts, canvases, numeric tickers,
 * relative timestamps) are masked per-route or via GLOBAL_MASK.
 *
 * Routes use HashRouter paths (the app mounts under `/#`). Keep the set small
 * and high-signal (~10 routes): every route renders the shell chrome (sidebar,
 * topbar) plus its own surfaces, so shell coverage comes for free.
 */

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export interface VisualRoute {
  /** Stable id → baseline filename `<id>__<theme>.png`. */
  id: string;
  /** Hash path appended after `/#`, e.g. '/dashboards'. */
  hash: string;
  /** Extra volatile selectors to mask on top of GLOBAL_MASK. */
  mask?: string[];
  /** Optional selector to await before snapshot (hydration anchor). */
  waitFor?: string;
}

/**
 * Volatile regions masked on every route. These hold live/random data whose
 * pixels legitimately change between runs and must not fail the color gate.
 */
export const GLOBAL_MASK: string[] = [
  'canvas',
  '.recharts-surface',
  '.recharts-wrapper',
  '[data-visual-volatile]',
];

export const VISUAL_ROUTES: VisualRoute[] = [
  { id: 'dashboards', hash: '/dashboards' },
  { id: 'segments', hash: '/segments' },
  { id: 'ops', hash: '/ops' },
  { id: 'catalog', hash: '/catalog' },
  { id: 'liveops-cohort', hash: '/liveops/cohort' },
  { id: 'advisor', hash: '/advisor' },
  { id: 'drift-center', hash: '/drift-center' },
  { id: 'settings', hash: '/settings' },
  { id: 'build', hash: '/build' },
  { id: 'whats-new', hash: '/whats-new' },
  // Chat + DevAudit added to cover the T.* -> semantic shell-token migration on
  // those surfaces. Chat empty-state is deterministic (static starters/composer);
  // DevAudit chrome is tokenized while its live session/cache data is masked.
  { id: 'chat', hash: '/chat' },
  { id: 'dev-audit', hash: '/dev/chat-audit' },
];
