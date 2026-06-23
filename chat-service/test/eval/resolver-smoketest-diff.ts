/**
 * Before/after diff for the resolver-routing smoketest.
 *
 * Reads the curated bank + two snapshots (pre-fix baseline and post-fix) and
 * judges each case by its `smokeMode`:
 *   - 'fix'   → PASS when the AFTER run answered (status ok), the resolved
 *               measure matches `expectedRef` (when given), and the resolved
 *               dimensions include `expectedDim` (when given). The BEFORE column
 *               is shown for context (it should be the failing/clarify state).
 *   - 'guard' → PASS when behaviour is UNCHANGED: same status, same resolvedRef,
 *               same dims before vs after. Catches both regressions (a working
 *               case breaks) and over-defaulting (an empty/garbage case starts
 *               emitting an artifact).
 *
 *   BANK=test/eval/resolver-smoketest-bank.json \
 *   BEFORE=test/eval/cfm_vn-smoketest-before.json \
 *   AFTER=test/eval/cfm_vn-smoketest-after.json \
 *     npx tsx test/eval/resolver-smoketest-diff.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));

interface BankCase {
  id: string;
  question: string;
  expectedRef: string | null;
  smokeMode?: 'fix' | 'guard';
  expectedDim?: string | null;
}
interface SnapResult {
  caseId: string;
  status: string;
  resolvedRef: string | null;
  resolvedDims?: string[];
}

function loadSnap(p: string): Map<string, SnapResult> {
  const j = JSON.parse(readFileSync(resolve(p), 'utf8')) as { results: SnapResult[] };
  return new Map(j.results.map((r) => [r.caseId, r]));
}

function dimStr(r?: SnapResult): string {
  return (r?.resolvedDims ?? []).join(',') || '·';
}

function main(): void {
  const bankPath = process.env['BANK'] ?? join(__dir, 'resolver-smoketest-bank.json');
  const beforePath = process.env['BEFORE'];
  const afterPath = process.env['AFTER'];
  if (!beforePath || !afterPath) {
    console.error('Set BEFORE= and AFTER= snapshot paths.');
    process.exit(2);
  }
  const bank = (JSON.parse(readFileSync(resolve(bankPath), 'utf8')) as { cases: BankCase[] }).cases;
  const before = loadSnap(beforePath);
  const after = loadSnap(afterPath);

  let pass = 0;
  let fail = 0;
  const rows: string[] = [];
  for (const c of bank) {
    const b = before.get(c.id);
    const a = after.get(c.id);
    const mode = c.smokeMode ?? 'fix';
    let ok: boolean;
    let why = '';

    if (mode === 'guard') {
      ok = !!b && !!a && b.status === a.status && b.resolvedRef === a.resolvedRef && dimStr(b) === dimStr(a);
      if (!ok) why = 'behaviour changed';
    } else {
      const answered = a?.status === 'ok';
      const refOk = !c.expectedRef || a?.resolvedRef === c.expectedRef;
      const dimOk = !c.expectedDim || (a?.resolvedDims ?? []).includes(c.expectedDim);
      ok = answered && refOk && dimOk;
      if (!answered) why = `after=${a?.status ?? 'missing'}`;
      else if (!refOk) why = `ref ${a?.resolvedRef ?? '·'}≠${c.expectedRef}`;
      else if (!dimOk) why = `dim missing ${c.expectedDim}`;
    }
    ok ? pass++ : fail++;

    const mark = ok ? 'PASS' : 'FAIL';
    rows.push(
      `${mark}  ${mode.padEnd(5)} ${c.id.padEnd(18)} ` +
        `before[${(b?.status ?? '∅').padEnd(11)} ${(b?.resolvedRef ?? '·')}/${dimStr(b)}]  ` +
        `after[${(a?.status ?? '∅').padEnd(11)} ${(a?.resolvedRef ?? '·')}/${dimStr(a)}]` +
        (why ? `  ← ${why}` : ''),
    );
  }

  console.log(`\nResolver smoketest diff — ${beforePath} → ${afterPath}\n`);
  console.log(rows.join('\n'));
  console.log(`\n${pass} pass · ${fail} fail · ${bank.length} cases`);
  if (fail > 0) process.exit(1);
}

main();
