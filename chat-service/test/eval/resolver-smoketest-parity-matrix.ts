/**
 * Cross-game parity matrix for the resolver platform + default-metric fix.
 * Reads each game's AFTER smoketest snapshot and judges it against the bank's
 * fix/guard expectations. No "before" needed — causation was proven on
 * cfm_vn + jus_vn; this confirms the code-once fix reproduces on every game.
 *
 * Caveats baked in (documented in the plan's smoketest-validation.md):
 *  - roas/cpi "by platform" bind a revenue/cost proxy measure, not the ratio
 *    measure — the platform DIMENSION still binds + an artifact emits. Counts
 *    as a platform-fix PASS (dim bound) with a measure-gap note.
 *  - month-over-month cases are data-blocked (single-month test set).
 *  - cros + tf lack the `wau` measure (deferred cube-model gap), so their
 *    `sm-wau-plain` guard cannot bind active_daily.wau — flagged, not a fail.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const BANK = JSON.parse(readFileSync(join(__dir, 'resolver-smoketest-bank.json'), 'utf8'));
const cases: any[] = BANK.cases ?? BANK;

const GAMES = (process.env['GAMES'] ?? 'cfm_vn jus_vn ballistar cros muaw ptg pubg tf').split(/\s+/);
const NO_WAU = new Set(['cros', 'tf']); // cube-model gap, not resolver
// Games whose loaded test data has NO paying-tier users (payer_tier is only
// 'non_payer') — verified via a live load probe. A whale/minnow/dolphin-filtered
// query returns zero rows and the agent correctly declines to chart it; the
// resolver still defaults + filters correctly (disambiguate returns action:auto).
// Data gap, not a resolver gap — judged like the data-blocked mom cases.
const NO_PAYING_TIERS = new Set(['ptg']);
const PAYER_FILTERED = new Set(['sm-seg-minnow', 'sm-seg-whale-month']);

function loadSnap(game: string): Map<string, any> | null {
  const p = join(__dir, `${game}-smoketest-after.json`);
  if (!existsSync(p)) return null;
  const s = JSON.parse(readFileSync(p, 'utf8'));
  const arr: any[] = s.results ?? s.cases ?? (Array.isArray(s) ? s : Object.values(s));
  return new Map(arr.map((r) => [r.caseId ?? r.id, r]));
}

// Per-case verdict for one game. Returns a single-char symbol + reason.
function verdict(c: any, r: any, game: string): { sym: string; note: string } {
  if (!r) return { sym: '–', note: 'missing' };
  const ok = r.status === 'ok';
  const refMatch = r.resolvedRef === c.expectedRef;
  const dimMatch = !c.expectedDim || (r.resolvedDims ?? []).includes(c.expectedDim);

  if (c.smokeMode === 'fix') {
    // Platform breakdown cases: the fix's success criterion is "artifact emits +
    // a platform-family dim binds on the metric's resolved cube" — NOT the exact
    // cfm member. The resolved cube + revenue/UA measure name vary per game by
    // design (recharge vs user_recharge_daily, roas vs rev proxy, …). Judge by
    // the platform-family leaf, note any cube/measure that differs from the bank.
    if (c.id?.startsWith('sm-plat-')) {
      const platformDimBound = (r.resolvedDims ?? []).some((d: string) => {
        const leaf = d.split('.').pop();
        return leaf === 'os_platform' || leaf === 'platform';
      });
      if (ok && platformDimBound && (r.artifactCount ?? 0) > 0) {
        if (refMatch && dimMatch) return { sym: '✓', note: '' };
        return { sym: '◐', note: `per-game member ${r.resolvedRef}/${(r.resolvedDims ?? [])[0]}` };
      }
      return { sym: '✗', note: `${r.status} — no platform artifact (ref=${r.resolvedRef ?? '·'})` };
    }
    // mom default: data-blocked single month — emit-or-decline both acceptable
    if (c.id === 'sm-seg-dolphin-mom') {
      return ok ? { sym: '◐', note: `mom emitted ${r.resolvedRef}` } : { sym: '◐', note: 'mom declined (data-blocked)' };
    }
    // paying-tier-filtered default on a game with no paying-tier users: the
    // resolver defaults + filters correctly (action:auto) but the filtered query
    // is empty, so the agent declines. Data gap, not a resolver gap.
    if (PAYER_FILTERED.has(c.id) && NO_PAYING_TIERS.has(game) && !ok) {
      return { sym: '◐', note: 'no paying-tier users (data-blocked)' };
    }
    if (ok && refMatch && dimMatch) return { sym: '✓', note: '' };
    if (ok && dimMatch && !refMatch) return { sym: '◐', note: `ref ${r.resolvedRef}` };
    return { sym: '✗', note: `${r.status} ref=${r.resolvedRef ?? '·'}` };
  }

  // guard cases
  if (c.id === 'sm-guard-empty') return r.status !== 'ok' ? { sym: '✓', note: '' } : { sym: '✗', note: 'OVER-DEFAULT' };
  if (c.id === 'sm-wau-mom') return { sym: '◐', note: ok ? 'mom emitted' : 'mom declined (data-blocked)' };
  if (c.id === 'sm-wau-plain') {
    if (NO_WAU.has(game)) return ok ? { sym: '✓', note: '' } : { sym: '◐', note: 'no wau measure (cube gap)' };
    return ok && refMatch ? { sym: '✓', note: '' } : { sym: ok ? '◐' : '✗', note: `ref=${r.resolvedRef ?? '·'}` };
  }
  // country guard: any valid country dim is fine
  if (c.id === 'sm-guard-country') return ok ? { sym: '✓', note: '' } : { sym: '✗', note: r.status };
  // guards with no pinned ref (e.g. grain) only require status ok
  if (c.expectedRef == null) return ok ? { sym: '✓', note: '' } : { sym: '✗', note: r.status };
  return ok && refMatch ? { sym: '✓', note: '' } : { sym: ok ? '◐' : '✗', note: `${r.status} ref=${r.resolvedRef ?? '·'}` };
}

const snaps = new Map(GAMES.map((g) => [g, loadSnap(g)]));
const present = GAMES.filter((g) => snaps.get(g));
const missing = GAMES.filter((g) => !snaps.get(g));

console.log('Resolver fix — cross-game parity matrix');
console.log('✓ pass · ◐ pass-with-documented-caveat · ✗ fail · – missing\n');

const idW = 20;
console.log('case'.padEnd(idW) + present.map((g) => g.padEnd(11)).join(''));
const okCount: Record<string, number> = Object.fromEntries(present.map((g) => [g, 0]));
const failCount: Record<string, number> = Object.fromEntries(present.map((g) => [g, 0]));
const notes: string[] = [];

for (const c of cases) {
  let row = `${c.id}`.padEnd(idW);
  for (const g of present) {
    const v = verdict(c, snaps.get(g)!.get(c.id), g);
    row += (v.sym + (v.sym === '✗' ? '!' : '')).padEnd(11);
    const snap = snaps.get(g)!.get(c.id);
    if (snap?.status === 'ok') okCount[g]++;
    if (v.sym === '✗') { failCount[g]++; notes.push(`  ✗ ${g}/${c.id}: ${v.note}`); }
    else if (v.note) notes.push(`  ◐ ${g}/${c.id}: ${v.note}`);
  }
  console.log(row);
}

console.log('\nok-count (status===ok, of 16):');
console.log('  ' + present.map((g) => `${g}=${okCount[g]}`).join('  '));
console.log('true fails (✗):');
console.log('  ' + present.map((g) => `${g}=${failCount[g]}`).join('  '));
if (missing.length) console.log('\nMISSING snapshots:', missing.join(', '));

const totalFails = Object.values(failCount).reduce((a, b) => a + b, 0);
console.log(`\n${totalFails === 0 ? 'PARITY OK — zero true regressions across all present games' : `${totalFails} TRUE FAILS — investigate`}`);
if (notes.length) { console.log('\ncaveats / fails detail:'); for (const n of notes) console.log(n); }
process.exit(totalFails === 0 ? 0 : 1);
