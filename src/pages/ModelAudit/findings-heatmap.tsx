/**
 * All-games heatmap: rows = union of cube logical names, columns = games. Each
 * cell is colored by that cube×game's worst (filtered) finding severity — clean
 * cells green, no-oracle-counterpart cells hatched, absent cells a dim dot. The
 * cube-name column is sticky; the games axis scrolls horizontally so the page
 * body never scrolls sideways.
 */

import React, { useMemo } from 'react';
import type { ParityFinding, RunCube } from './model-audit-types';
import { cellTokens, worseSeverity } from './model-audit-format';

export interface CellData {
  present: boolean;
  hasProd: boolean;
  worst: string | null;
  count: number;
}

function key(game: string, cube: string): string {
  return `${game}::${cube}`;
}

export function buildGrid(
  games: string[],
  cubes: RunCube[],
  findings: ParityFinding[],
): { rows: string[]; cellOf: (game: string, cube: string) => CellData } {
  const cubeSet = new Map<string, RunCube>();
  for (const c of cubes) cubeSet.set(key(c.game, c.cube), c);
  const rows = [...new Set(cubes.map((c) => c.cube))].sort();

  const findingMap = new Map<string, ParityFinding[]>();
  for (const f of findings) {
    const k = key(f.game, f.cube);
    const arr = findingMap.get(k);
    if (arr) arr.push(f);
    else findingMap.set(k, [f]);
  }

  const cellOf = (game: string, cube: string): CellData => {
    const k = key(game, cube);
    const rc = cubeSet.get(k);
    const fs = findingMap.get(k) ?? [];
    let worst: string | null = null;
    for (const f of fs) worst = worseSeverity(worst, f.severity);
    return { present: rc != null, hasProd: rc?.hasProd ?? false, worst, count: fs.length };
  };

  return { rows, cellOf };
}

const HATCH =
  'repeating-linear-gradient(45deg, var(--bg-muted), var(--bg-muted) 4px, transparent 4px, transparent 8px)';

function Cell({
  data,
  onClick,
  title,
}: {
  data: CellData;
  onClick: () => void;
  title: string;
}) {
  if (!data.present) {
    return <td style={{ ...tdBase, color: 'var(--text-muted)', textAlign: 'center' }} aria-hidden>·</td>;
  }
  const tokens = cellTokens(data.worst);
  const background = data.worst ? tokens.soft : data.hasProd ? tokens.soft : HATCH;
  return (
    <td style={tdBase}>
      <button
        type="button"
        onClick={onClick}
        title={title}
        style={{
          width: '100%',
          height: 26,
          border: '1px solid var(--border-card)',
          borderRadius: 4,
          background,
          color: tokens.ink,
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {data.count > 0 ? data.count : data.worst ? '' : data.hasProd ? '✓' : ''}
      </button>
    </td>
  );
}

export function FindingsHeatmap({
  games,
  cubes,
  findings,
  onCellClick,
}: {
  games: string[];
  cubes: RunCube[];
  findings: ParityFinding[];
  onCellClick: (game: string, cube: string) => void;
}) {
  const { rows, cellOf } = useMemo(() => buildGrid(games, cubes, findings), [games, cubes, findings]);

  if (rows.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '24px 0' }}>No cubes in this run.</div>;
  }

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 4, minWidth: 'max-content' }}>
        <thead>
          <tr>
            <th style={{ ...thBase, ...stickyCol, textAlign: 'left' }}>cube</th>
            {games.map((g) => (
              <th key={g} style={{ ...thBase, minWidth: 56 }}>
                {g}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cube) => (
            <tr key={cube}>
              <th style={{ ...thBase, ...stickyCol, textAlign: 'left', fontWeight: 600 }}>{cube}</th>
              {games.map((g) => {
                const data = cellOf(g, cube);
                const label = data.present
                  ? `${cube} · ${g}: ${data.count} finding(s)${data.hasProd ? '' : ' · no oracle'}`
                  : `${cube} · ${g}: not modeled`;
                return <Cell key={g} data={data} onClick={() => onCellClick(g, cube)} title={label} />;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const tdBase: React.CSSProperties = { padding: 0, verticalAlign: 'middle' };
const thBase: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  padding: '4px 6px',
  whiteSpace: 'nowrap',
};
const stickyCol: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 1,
  background: 'var(--bg-card)',
  minWidth: 160,
  color: 'var(--text-secondary)',
};
