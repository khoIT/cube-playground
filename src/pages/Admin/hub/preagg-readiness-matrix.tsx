/**
 * PreaggReadinessMatrix — the "what needs building" panel of the Pre-agg Runs
 * command center.
 *
 * Sweep history answers "what did the worker just do"; this matrix answers the
 * operator's other question — "which game × rollup is serveable RIGHT NOW, and
 * what still needs a build". One row per game, one column per pre-agg-bearing
 * cube (the probe registry), each cell the live probe classification:
 *
 *   built   — partition exists, rollup serves
 *   unbuilt — Cube raised partition-not-built; queries on it hard-fail
 *   error   — probe couldn't classify (timeout / auth / cube missing)
 *
 * Each game row carries its own Build button (reuses the scoped worker build
 * trigger) so unbuilt cells can be acted on in place.
 */

import React from 'react';
import type { GameReadinessSummary, ProbeCubeResult } from './preagg-runs-data';

const TONE: Record<ProbeCubeResult['status'], React.CSSProperties> = {
  built:   { background: 'var(--success-soft)',     color: 'var(--success-ink)' },
  unbuilt: { background: 'var(--muted-soft)',       color: 'var(--muted-ink)' },
  error:   { background: 'var(--destructive-soft)', color: 'var(--destructive-ink)' },
};

function CellChip({ result }: { result: ProbeCubeResult | undefined }) {
  if (!result) {
    return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>;
  }
  return (
    <span
      title={result.message ?? `${result.cube}: ${result.status}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 20,
        padding: '0 8px',
        borderRadius: 'var(--radius-full)',
        fontSize: 10.5,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        ...TONE[result.status],
      }}
    >
      {result.status}
    </span>
  );
}

export interface PreaggReadinessMatrixProps {
  games: GameReadinessSummary[];
  generatedAt: string | null;
  triggerEnabled: boolean;
  /** Game id currently being built by the trigger, or null. */
  buildingGame: string | null;
  onBuild: (game: string) => void;
}

export function PreaggReadinessMatrix({
  games, generatedAt, triggerEnabled, buildingGame, onBuild,
}: PreaggReadinessMatrixProps) {
  if (games.length === 0) return null;

  // Column set: union of probed cubes across games, in first-seen order (the
  // probe emits them in registry order, so all games agree).
  const cubeCols: string[] = [];
  for (const g of games) {
    for (const c of g.cubes ?? []) {
      if (!cubeCols.includes(c.cube)) cubeCols.push(c.cube);
    }
  }
  if (cubeCols.length === 0) return null;

  const buildRunning = buildingGame != null;

  const th: React.CSSProperties = {
    padding: '8px 10px',
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--text-muted)',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    padding: '7px 10px',
    borderTop: '1px solid var(--border-card)',
    whiteSpace: 'nowrap',
  };

  return (
    <section
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-md)',
        marginBottom: 18,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-card)', display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Rollup readiness</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          live probe · what still needs a build
        </span>
        {generatedAt && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
            probed {new Date(generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'var(--font-sans)' }}>
          <thead>
            <tr>
              <th style={th}>Game</th>
              {cubeCols.map((c) => (
                <th key={c} style={{ ...th, fontFamily: 'var(--font-mono)', textTransform: 'none', letterSpacing: 0 }}>{c}</th>
              ))}
              {triggerEnabled && <th style={{ ...th, textAlign: 'right' }} />}
            </tr>
          </thead>
          <tbody>
            {games.map((g) => {
              const byCube = new Map((g.cubes ?? []).map((c) => [c.cube, c]));
              const toBuild = g.unbuilt + g.errored;
              const isBuilding = buildingGame === g.id;
              return (
                <tr key={g.id}>
                  <td style={td}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{g.id}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>{g.label}</span>
                  </td>
                  {cubeCols.map((c) => (
                    <td key={c} style={td}><CellChip result={byCube.get(c)} /></td>
                  ))}
                  {triggerEnabled && (
                    <td style={{ ...td, textAlign: 'right' }}>
                      {toBuild > 0 || isBuilding ? (
                        <button
                          type="button"
                          disabled={buildRunning}
                          onClick={() => onBuild(g.id)}
                          title={
                            buildRunning
                              ? isBuilding ? `Building ${g.id}…` : 'A build is already running'
                              : `Build ${g.id}'s ${toBuild} missing rollup partition${toBuild === 1 ? '' : 's'} now`
                          }
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            height: 24,
                            padding: '0 10px',
                            fontSize: 11.5,
                            fontWeight: 600,
                            fontFamily: 'var(--font-sans)',
                            color: 'var(--brand)',
                            background: 'var(--brand-soft)',
                            border: '1px solid var(--brand)',
                            borderRadius: 'var(--radius-sm)',
                            cursor: buildRunning ? 'not-allowed' : 'pointer',
                            opacity: buildRunning && !isBuilding ? 0.45 : 1,
                          }}
                        >
                          {isBuilding && (
                            <span style={{ width: 6, height: 6, borderRadius: 'var(--radius-full)', background: 'var(--brand)', animation: 'pulse 1.8s ease-in-out infinite' }} />
                          )}
                          {isBuilding ? 'Building…' : `Build ${toBuild}`}
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--success-ink)' }}>all built</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
