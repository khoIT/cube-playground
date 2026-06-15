#!/usr/bin/env node
/**
 * Theme-drift linter — guards the single semantic-token contract.
 *
 * Fails (exit 1) when component code reintroduces the drift the
 * centralization refactor removed:
 *   1. Inline hex colors in src/**\/*.{ts,tsx} (outside the data-viz allowlist).
 *   2. Raw scale refs — var(--neutral-*) / var(--hermes-*) — anywhere outside
 *      the theme layer (those primitives are private to src/theme/).
 *   3. The retired T.<color> proxy (T now exposes fonts only).
 *
 * Why a bespoke script instead of eslint/stylelint: the repo has no lint
 * tooling, and standing up a full ruleset would flag mountains of unrelated
 * pre-existing issues. This is scoped to exactly the three drift patterns,
 * runs in well under a second, and needs zero new dependencies.
 *
 * Wired to `npm run lint` and the pre-push hook (scripts/git-hooks/pre-push).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SRC = join(ROOT, 'src');

// The theme layer is the sole home of raw values — primitives and the
// per-theme token definitions live here. Never linted for hex / raw refs.
const THEME_LAYER = 'src/theme/';

// Files where inline hex is legitimate and tokens cannot apply:
//  - recharts SVG fill/stroke (CSS var() does not resolve in SVG attrs)
//  - categorical data-viz ramps / chart series palettes
//  - syntax-highlight tone palettes (formula / YAML / column-type swatches)
//  - 3rd-party brand marks
// Keep this list minimal and justified; everything else must use tokens.
const HEX_ALLOWLIST = new Set([
  // chart series / data-viz palettes (SVG attrs + categorical ramps)
  'src/theme.ts',
  'src/shell/theme.tsx',
  'src/QueryBuilderV2/analysis/funnel-results.tsx',
  'src/QueryBuilderV2/analysis/distribution-mode.tsx',
  'src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/test-run-charts.tsx',
  'src/QueryBuilderV2/components/ChartRenderer.tsx',
  'src/pages/Chat/components/chart-heatmap.tsx',
  'src/pages/Liveops/cohort/intensity-ramp.ts',
  'src/pages/Liveops/cohort/cohort-grid.tsx',
  'src/pages/Liveops/cohort/index.tsx',
  'src/pages/OpsConsole/use-ops-overview.ts',
  'src/pages/Segments/funnel-builder/funnel-bar-list.tsx',
  // categorical type / syntax-tone palettes
  'src/QueryBuilderV2/NewMetric/full-page/steps/step-1-source/source-preview-rail.tsx',
  'src/QueryBuilderV2/NewMetric/full-page/steps/step-5-identity/yaml-preview-rail.tsx',
  'src/pages/Catalog/metric-detail/tab-formula.tsx',
  'src/pages/Catalog/schema-cartographer/cube-tree.tsx',
  'src/pages/Catalog/metric-detail/lineage-columns.tsx',
  'src/QueryBuilder/MemberDropdown.tsx',
  // brand / 3rd-party / minor
  'src/shared/icons/CubejsIcon.tsx',
  'src/pages/Catalog/digest/digest-page.tsx',
  'src/components/GlobalStyles.tsx',
  'src/rollup-designer/components/Settings.tsx',
  // DEFERRED: trust hues (#0f7a3a / #8a5a05) differ from the trust-badge
  // token canon; converging needs a light-mode re-baseline. Tracked exception.
  'src/pages/Catalog/metrics-tab/metric-list-row.tsx',
]);

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const RAW_SCALE_RE = /var\(\s*--(?:neutral|hermes)-/;
const T_COLOR_RE = /\bT\.(?:colors?|bg|fg|border|text|surface|brand|accent|danger|success|warning|info|muted|positive|negative)\b/;

const isTest = (p) => /(\.test\.[tj]sx?$)|(__tests__\/)/.test(p);
const isCommentLine = (line) => {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--');
};

/** Recursively collect source files under src/. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (/\.(tsx?|css)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (rel.startsWith(THEME_LAYER)) continue; // theme layer owns raw values
  if (isTest(rel)) continue;                 // tests assert real values

  const isStyleOrCode = /\.(tsx?|css)$/.test(rel);
  const isTsx = /\.tsx?$/.test(rel);
  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, i) => {
    if (isCommentLine(line)) return;
    const ln = i + 1;

    // Rule 2 + 3: raw scale refs / T.<color> — banned everywhere (no allowlist)
    if (isStyleOrCode && RAW_SCALE_RE.test(line)) {
      violations.push(`${rel}:${ln}  raw scale ref (use a semantic token): ${line.trim()}`);
    }
    if (isTsx && T_COLOR_RE.test(line)) {
      violations.push(`${rel}:${ln}  retired T.<color> proxy: ${line.trim()}`);
    }

    // Rule 1: inline hex in .ts/.tsx — allowlisted data-viz files exempt
    if (isTsx && HEX_RE.test(line) && !HEX_ALLOWLIST.has(rel)) {
      violations.push(`${rel}:${ln}  inline hex (use a token, or add to allowlist if data-viz): ${line.trim()}`);
    }
  });
}

if (violations.length) {
  console.error(`\n✗ theme-token lint: ${violations.length} violation(s)\n`);
  for (const v of violations) console.error('  ' + v);
  console.error('\nFix: reference a semantic token from src/theme/tokens.css.');
  console.error('Genuine data-viz/SVG/brand hex → add the file to HEX_ALLOWLIST in scripts/lint-theme-tokens.mjs (with a reason).\n');
  process.exit(1);
}

console.log('✓ theme-token lint: no inline-hex / raw-scale / T.<color> drift');
