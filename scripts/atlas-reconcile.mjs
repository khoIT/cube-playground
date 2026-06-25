#!/usr/bin/env node
/**
 * Feature Atlas — reconcile proposal engine.
 *
 * READ-ONLY. Given the current atlas.yaml + repo signals, it emits a structured
 * list of PROPOSED ops (JSON to stdout). It NEVER writes atlas.yaml — the /atlas
 * skill renders the proposal as an approve/edit/drop checklist and does the write.
 * This separation keeps the engine deterministic and unit-testable.
 *
 * Signals harvested:
 *   - plans/*           new plan dirs created since reconciledAt  -> add-feature
 *   - plans/complete/*  a linked plan now lives under complete/   -> set-status: shipped
 *   - plan.md           frontmatter `status: completed`           -> set-status: shipped
 *   - atlas itself      shipped feature with open drawbacks       -> flag-health: at-risk
 *
 * Conservative by design (locked decision): it proposes only high-confidence,
 * mechanical changes. Directions/drawbacks remain a human curation job.
 *
 * Usage:
 *   node scripts/atlas-reconcile.mjs               # propose against src/feature-atlas/atlas.yaml
 *   node scripts/atlas-reconcile.mjs --atlas <path>
 *   node scripts/atlas-reconcile.mjs --json        # machine-readable proposal only
 *
 * The pure functions (computeProposals, indexFeaturesByPlanBasename, planDateFromDir)
 * are exported for tests; the I/O shell at the bottom gathers real signals.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { validateAtlas, normalizeAtlas } from '../src/feature-atlas/validate-atlas.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DEFAULT_ATLAS = join(REPO_ROOT, 'src/feature-atlas/atlas.yaml');

// ───────────────────────────── pure helpers ──────────────────────────────

/** Plan dir name -> ISO date from its YYMMDD prefix (e.g. 260624-... -> 2026-06-24), or null. */
export function planDateFromDir(dir) {
  const m = basename(dir).match(/^(\d{2})(\d{2})(\d{2})-/);
  if (!m) return null;
  return `20${m[1]}-${m[2]}-${m[3]}`;
}

/** Map plan-dir basename -> feature, from every feature's links.plans. */
export function indexFeaturesByPlanBasename(atlas) {
  const map = new Map();
  for (const surface of atlas.surfaces ?? []) {
    for (const f of surface.features ?? []) {
      for (const p of f.links?.plans ?? []) {
        map.set(basename(p), f);
      }
    }
  }
  return map;
}

/**
 * Pure proposal computation.
 * @param {object} args
 * @param {object} args.atlas            parsed, validated atlas
 * @param {string[]} args.activePlanDirs basenames under plans/ (excluding complete/)
 * @param {Set<string>} args.completePlanBasenames basenames present under plans/complete/
 * @param {Map<string,string>} args.planStatus  plan basename -> frontmatter status (optional)
 * @param {string} args.today            ISO date, for "since reconciledAt" comparison
 * @returns {Array<object>} proposed ops
 */
export function computeProposals({
  atlas,
  activePlanDirs = [],
  completePlanBasenames = new Set(),
  planStatus = new Map(),
  today,
}) {
  const ops = [];
  const byPlan = indexFeaturesByPlanBasename(atlas);
  const since = atlas.reconciledAt;
  const shippedLike = new Set(['shipped', 'deprecated']);

  // 1) New plan dirs created since reconciledAt and not linked to any feature -> add-feature.
  for (const dir of activePlanDirs) {
    const base = basename(dir);
    if (byPlan.has(base)) continue;
    const date = planDateFromDir(base);
    // only genuinely new since last reconcile, and not future-dated (typo/placeholder dirs)
    if (!date || !since || date <= since || (today && date > today)) continue;
    ops.push({
      op: 'add-feature',
      suggestedId: base.replace(/^\d{6}-\d{4}-/, ''),
      surface: null, // user assigns
      reason: `New plan dir since ${since} with no atlas feature`,
      source: `plans/${base}`,
    });
  }

  // 2) Linked plan now lives under complete/ -> propose shipped (if not already shipped-like).
  // 3) plan.md frontmatter status: completed -> same.
  for (const surface of atlas.surfaces ?? []) {
    for (const f of surface.features ?? []) {
      const planBases = (f.links?.plans ?? []).map((p) => basename(p));
      const movedToComplete = planBases.some((b) => completePlanBasenames.has(b));
      const frontmatterDone = planBases.some((b) => planStatus.get(b) === 'completed');
      if ((movedToComplete || frontmatterDone) && !shippedLike.has(f.status)) {
        ops.push({
          op: 'set-status',
          featureId: f.id,
          from: f.status,
          to: 'shipped',
          reason: movedToComplete
            ? 'Linked plan moved to plans/complete/'
            : 'Linked plan.md frontmatter status: completed',
          source: planBases.join(', '),
        });
      }

      // 4) shipped + open drawbacks + currently healthy -> at-risk candidate.
      if (f.status === 'shipped' && f.health === 'healthy' && (f.drawbacks?.length ?? 0) > 0) {
        ops.push({
          op: 'flag-health',
          featureId: f.id,
          from: 'healthy',
          to: 'at-risk',
          reason: `${f.drawbacks.length} open drawback(s) on a healthy shipped feature`,
          source: f.id,
        });
      }
    }
  }

  return ops;
}

// ───────────────────────────── I/O shell ──────────────────────────────────

function parseArgs(argv) {
  const args = { atlas: DEFAULT_ATLAS, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--atlas') {
      const v = argv[++i];
      if (!v) { console.error('--atlas requires a path'); process.exit(2); }
      args.atlas = resolve(v);
    } else if (a === '--json') args.json = true;
  }
  return args;
}

function listDirs(p) {
  if (!existsSync(p)) return [];
  return readdirSync(p, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

/** Best-effort: read `status:` from a plan.md YAML frontmatter without a full parse. */
function readPlanStatus(plansDir, base) {
  const planMd = join(plansDir, base, 'plan.md');
  if (!existsSync(planMd)) return null;
  const text = readFileSync(planMd, 'utf8');
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const m = fm[1].match(/^status:\s*["']?([a-z-]+)["']?\s*$/m);
  return m ? m[1] : null;
}

function gatherSignals(plansDir) {
  const reserved = new Set(['complete', 'reports', 'templates', 'visuals']);
  const activePlanDirs = listDirs(plansDir).filter((d) => !reserved.has(d));
  const completePlanBasenames = new Set(listDirs(join(plansDir, 'complete')));
  const planStatus = new Map();
  for (const base of activePlanDirs) {
    const s = readPlanStatus(plansDir, base);
    if (s) planStatus.set(base, s);
  }
  return { activePlanDirs, completePlanBasenames, planStatus };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.atlas)) {
    console.error('atlas not found: ' + args.atlas);
    process.exit(1);
  }
  const raw = readFileSync(args.atlas, 'utf8');
  const atlas = normalizeAtlas(yaml.load(raw));

  const { valid, errors } = validateAtlas(atlas);
  if (!valid) {
    console.error('atlas.yaml failed validation:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }

  const plansDir = join(REPO_ROOT, 'plans');
  const signals = gatherSignals(plansDir);
  const today = new Date().toISOString().slice(0, 10);
  const ops = computeProposals({ atlas, ...signals, today });

  if (args.json) {
    process.stdout.write(JSON.stringify({ reconciledAt: atlas.reconciledAt, today, ops }, null, 2) + '\n');
    return;
  }

  console.log(`Feature Atlas reconcile — proposal (read-only)`);
  console.log(`  atlas: ${args.atlas}`);
  console.log(`  last reconciled: ${atlas.reconciledAt}  ·  today: ${today}`);
  console.log(`  features: ${(atlas.surfaces ?? []).reduce((n, s) => n + (s.features?.length ?? 0), 0)} across ${(atlas.surfaces ?? []).length} surfaces`);
  console.log('');
  if (ops.length === 0) {
    console.log('  ✓ No proposed changes — atlas is in sync with plans/.');
    return;
  }
  console.log(`  ${ops.length} proposed op(s):`);
  for (const op of ops) {
    const head = op.op === 'add-feature'
      ? `add-feature  ~${op.suggestedId}`
      : `${op.op}  ${op.featureId}` + (op.to ? `  -> ${op.to}` : '');
    console.log(`   • ${head}`);
    console.log(`       reason: ${op.reason}`);
    console.log(`       source: ${op.source}`);
  }
  console.log('');
  console.log('  These are PROPOSALS. The /atlas skill applies them after approve/edit/drop.');
}

// Run only as a CLI, not when imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
