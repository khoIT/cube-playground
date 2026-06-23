/**
 * Persona answer-quality grader — cross-game view over persona-answer-quality-bank.json.
 *
 * Two lanes, mirroring the bank's dataClass tag:
 *   shape      → graded structurally here, every game, CI-cheap. Success =
 *                an acceptable-member LEAF binds (cube-relative tail match) AND
 *                an artifact emits; for coverage-honesty cases (expectsDecline),
 *                success = the turn declines/discloses instead of charting.
 *   analytics  → needs real multi-period / payer-rich data the single-month
 *                synthetic corpus can't supply. Reported as illustrative (◐),
 *                never a fail — these graduate to an LLM-judge pass against a
 *                richer corpus (rubric weights live on each case).
 *
 * Reads the same per-game snapshots the runner already writes
 * (<game>-persona-after.json by default). Member matching is leaf-only on
 * purpose: the resolved cube/measure name varies per game by design, only the
 * leaf concept is stable — same reason the resolver fix landed code-once.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const BANK = JSON.parse(readFileSync(join(__dir, 'persona-answer-quality-bank.json'), 'utf8'));
const cases: any[] = BANK.cases ?? [];

const GAMES = (process.env['GAMES'] ?? 'cfm_vn jus_vn ballistar cros muaw ptg pubg tf').split(/\s+/);
const SNAP = process.env['SNAP_SUFFIX'] ?? 'persona-after';

const leaf = (m: string) => (m ?? '').split('.').pop() ?? '';

function loadSnap(game: string): Map<string, any> | null {
  const p = join(__dir, `${game}-${SNAP}.json`);
  if (!existsSync(p)) return null;
  const s = JSON.parse(readFileSync(p, 'utf8'));
  const arr: any[] = s.results ?? s.cases ?? (Array.isArray(s) ? s : Object.values(s));
  return new Map(arr.map((r) => [r.caseId ?? r.id, r]));
}

// One game's verdict for one case. shape → structural; analytics → illustrative.
function verdict(c: any, r: any): { sym: string; note: string } {
  if (!r) return { sym: '–', note: 'missing' };
  const ok = r.status === 'ok';
  const emitted = (r.artifactCount ?? 0) > 0;

  if (c.dataClass === 'analytics') {
    // Not pass/fail on synthetic data — record what happened for the eventual
    // LLM-judge run against a richer corpus.
    return { sym: '◐', note: ok ? `emitted ${r.resolvedRef ?? '·'}` : `declined (${r.status})` };
  }

  // shape lane
  if (c.expectsDecline) {
    return ok && emitted
      ? { sym: '✗', note: 'charted an out-of-coverage range (should disclose/decline)' }
      : { sym: '✓', note: 'declined/disclosed out-of-coverage range' };
  }

  const bound = [r.resolvedRef, ...(r.resolvedDims ?? [])].map(leaf);
  const wantMembers: string[] = c.acceptableMembers ?? [];
  const memberOk = wantMembers.length === 0 || wantMembers.some((m: string) => bound.includes(leaf(m)));
  const wantDims: string[] = c.acceptableDims ?? [];
  const dimOk = wantDims.length === 0 || wantDims.some((d: string) => (r.resolvedDims ?? []).map(leaf).includes(leaf(d)));

  if (ok && emitted && memberOk && dimOk) return { sym: '✓', note: '' };
  if (ok && emitted && !memberOk) return { sym: '◐', note: `bound ${r.resolvedRef ?? '·'} — not in acceptable set` };
  if (ok && emitted && !dimOk) return { sym: '◐', note: `no acceptable breakdown dim (got ${(r.resolvedDims ?? []).join(',') || 'none'})` };
  return { sym: '✗', note: `${r.status} — no artifact (ref=${r.resolvedRef ?? '·'})` };
}

const snaps = new Map(GAMES.map((g) => [g, loadSnap(g)]));
const present = GAMES.filter((g) => snaps.get(g));
const missing = GAMES.filter((g) => !snaps.get(g));

console.log('Persona answer-quality — cross-game matrix');
console.log('✓ pass · ◐ caveat/illustrative · ✗ fail · – missing');
console.log('(analytics-class cases are illustrative — never counted as fails)\n');

const idW = 26;
console.log('case'.padEnd(idW) + 'class'.padEnd(11) + present.map((g) => g.padEnd(11)).join(''));
const shapeFail: Record<string, number> = Object.fromEntries(present.map((g) => [g, 0]));
const notes: string[] = [];

for (const c of cases) {
  let row = `${c.id}`.padEnd(idW) + `${c.dataClass}`.padEnd(11);
  for (const g of present) {
    const v = verdict(c, snaps.get(g)!.get(c.id));
    row += (v.sym + (v.sym === '✗' ? '!' : '')).padEnd(11);
    if (v.sym === '✗') { shapeFail[g]++; notes.push(`  ✗ ${g}/${c.id}: ${v.note}`); }
    else if (v.note) notes.push(`  ◐ ${g}/${c.id}: ${v.note}`);
  }
  console.log(row);
}

console.log('\nshape-lane true fails (✗):');
console.log('  ' + present.map((g) => `${g}=${shapeFail[g]}`).join('  '));
if (missing.length) console.log('\nMISSING snapshots:', missing.join(', '), `(run the bank first — CORPUS=test/eval/persona-answer-quality-bank.json SNAPSHOT_OUT=test/eval/<game>-${SNAP}.json)`);

const total = Object.values(shapeFail).reduce((a, b) => a + b, 0);
console.log(`\n${total === 0 ? 'SHAPE LANE OK — zero structural fails across present games' : `${total} SHAPE FAILS — investigate`}`);
if (notes.length) { console.log('\ncaveats / fails detail:'); for (const n of notes) console.log(n); }
process.exit(total === 0 ? 0 : 1);
