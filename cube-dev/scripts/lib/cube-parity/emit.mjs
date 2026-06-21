/**
 * Serialize audit findings to disk: a machine-readable JSONL ledger (one
 * finding per line — the contract the persistence recorder parses) and a
 * human-readable parity matrix (cubes × games, cell = worst open severity).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', '..', 'reports');

const SEVERITY_RANK = { correctness: 3, parity: 2, cosmetic: 1 };
const SEVERITY_CELL = { correctness: '🔴', parity: '🟡', cosmetic: '⚪', clean: '✅', none: '·' };

/** Worst (highest-rank) severity among a list of findings. */
function worstSeverity(findings) {
  let worst = null;
  let rank = 0;
  for (const f of findings) {
    const r = SEVERITY_RANK[f.severity] ?? 0;
    if (r > rank) {
      rank = r;
      worst = f.severity;
    }
  }
  return worst;
}

export function countBySeverity(findings) {
  const c = { correctness: 0, parity: 0, cosmetic: 0 };
  for (const f of findings) if (f.severity in c) c[f.severity] += 1;
  return c;
}

/** JSONL ledger — one finding object per line. */
export function writeFindingsJsonl(findings, file = 'parity-findings.jsonl') {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, file);
  writeFileSync(path, findings.map((f) => JSON.stringify(f)).join('\n') + (findings.length ? '\n' : ''));
  return path;
}

/**
 * Markdown matrix: rows = logical cubes (union across games), cols = games.
 * Cell shows the worst open finding severity for that (cube, game), `✅` when
 * the cube exists clean, `·` when the game has no such cube.
 */
export function writeParityMatrix(model, findings, file = 'parity-matrix.md') {
  mkdirSync(OUT_DIR, { recursive: true });
  const games = model.games.map((g) => g.game);

  // cube presence per game + finding bucket per (cube, game)
  const present = new Map(); // logical -> Set(game)
  for (const g of model.games) {
    for (const c of g.dev) {
      if (!present.has(c.logical)) present.set(c.logical, new Set());
      present.get(c.logical).add(g.game);
    }
  }
  const byCell = new Map(); // `${logical}|${game}` -> findings[]
  for (const f of findings) {
    const k = `${f.cube}|${f.game}`;
    if (!byCell.has(k)) byCell.set(k, []);
    byCell.get(k).push(f);
  }

  const cubes = [...present.keys()].sort();
  const counts = countBySeverity(findings);
  const lines = [];
  lines.push('# Cube parity matrix');
  lines.push('');
  lines.push(
    `Findings: 🔴 ${counts.correctness} correctness · 🟡 ${counts.parity} parity · ⚪ ${counts.cosmetic} cosmetic`,
  );
  lines.push('');
  lines.push('Legend: 🔴 correctness · 🟡 parity · ⚪ cosmetic · ✅ clean · · absent');
  lines.push('');
  lines.push(`| cube | ${games.join(' | ')} |`);
  lines.push(`|------|${games.map(() => '----').join('|')}|`);
  for (const cube of cubes) {
    const row = games.map((g) => {
      if (!present.get(cube).has(g)) return SEVERITY_CELL.none;
      const fs = byCell.get(`${cube}|${g}`) ?? [];
      const w = worstSeverity(fs);
      return w ? SEVERITY_CELL[w] : SEVERITY_CELL.clean;
    });
    lines.push(`| \`${cube}\` | ${row.join(' | ')} |`);
  }
  lines.push('');

  // Oracle availability footnote.
  lines.push('## Oracle coverage');
  lines.push('');
  for (const g of model.games) {
    lines.push(
      `- **${g.game}** → \`${g.schema}\`: ${g.oracleAvailable ? `oracle present (${g.oracle.length} cubes)` : 'NO oracle'} · dev ${g.dev.length} cubes`,
    );
  }
  lines.push('');

  const path = join(OUT_DIR, file);
  writeFileSync(path, lines.join('\n'));
  return path;
}

export { OUT_DIR };
