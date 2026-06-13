/**
 * PreaggReadinessMatrix — the "what needs building" panel of the Pre-agg Runs
 * command center.
 *
 * Sweep history answers "what did the worker just do"; this panel answers the
 * operator's other question — "which game × rollup is serveable RIGHT NOW, and
 * what still needs a build".
 *
 * Layout is one ROW PER GAME with that game's own rollup cubes as wrapping
 * chips — NOT a shared column grid. Since the probe registry is derived from
 * each game's model YAML, cube sets barely overlap across games (a union grid
 * is ~16 columns of mostly empty cells that scroll the game names out of
 * view). Per-game rows keep every game visible while its chips wrap in place:
 *
 *   built       — a rollup actually served the probe (usedPreAggregations non-empty)
 *   from-source — 200 but Cube fell through to Trino; rollup defined, not active
 *   unbuilt     — Cube raised partition-not-built; queries on it hard-fail
 *   error       — probe couldn't classify (timeout / auth / cube missing)
 *
 * Each game row carries its own Build button (reuses the scoped worker build
 * trigger) so unbuilt cells can be acted on in place.
 */

import React from 'react';
import type { GameReadinessSummary, ProbeCubeResult } from './preagg-runs-data';

const TONE: Record<ProbeCubeResult['status'], { bg: string; ink: string }> = {
  built:         { bg: 'var(--success-soft)',     ink: 'var(--success-ink)' },
  'from-source': { bg: 'var(--info-soft)',        ink: 'var(--info-ink)' },
  unbuilt:       { bg: 'var(--muted-soft)',       ink: 'var(--muted-ink)' },
  error:         { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)' },
};

/** Compact relative age — "3h", "2d" — for the seal timestamp on a chip. */
function sealAge(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** One rollup cube of a game: tone-coded pill with name + optional seal age. */
function CubeChip({ result }: { result: ProbeCubeResult }) {
  const tone = TONE[result.status];
  const age = result.lastSealedAt ? sealAge(result.lastSealedAt) : null;
  const sealedTitle = result.lastSealedAt
    ? ` — last sealed ${new Date(result.lastSealedAt).toLocaleString('en-GB')}`
    : '';
  return (
    <span
      title={`${result.cube}: ${result.status}${sealedTitle}${result.message ? `\n${result.message}` : ''}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 22,
        padding: '0 8px',
        borderRadius: 'var(--radius-full)',
        background: tone.bg,
        color: tone.ink,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 'var(--radius-full)', background: 'currentColor', flexShrink: 0 }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600 }}>{result.cube}</span>
      {age && <span style={{ fontSize: 9.5, opacity: 0.75 }}>· {age}</span>}
    </span>
  );
}

/** Legend swatch in the panel header. */
function LegendDot({ status, label }: { status: ProbeCubeResult['status']; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text-muted)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 'var(--radius-full)', background: TONE[status].bg, border: `1px solid ${TONE[status].ink}` }} />
      {label}
    </span>
  );
}

function BuildAction({ game, buildingGame, onBuild }: {
  game: GameReadinessSummary;
  buildingGame: string | null;
  onBuild: (game: string) => void;
}) {
  const cubes = game.cubes ?? [];
  // Anything not actively served by a rollup is a build candidate — unbuilt,
  // errored, AND from-source (passthrough: rollup defined but not materialised).
  const toBuild = cubes.length - game.built;
  const isBuilding = buildingGame === game.id;
  const buildRunning = buildingGame != null;

  if (cubes.length === 0) {
    return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>no rollups in model</span>;
  }
  if (toBuild === 0 && !isBuilding) {
    return <span style={{ fontSize: 11, color: 'var(--success-ink)' }}>all built</span>;
  }
  return (
    <button
      type="button"
      disabled={buildRunning}
      onClick={() => onBuild(game.id)}
      title={
        buildRunning
          ? isBuilding ? `Building ${game.id}…` : 'A build is already running'
          : `Build ${game.id}'s ${toBuild} missing rollup partition${toBuild === 1 ? '' : 's'} now`
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
        whiteSpace: 'nowrap',
      }}
    >
      {isBuilding && (
        <span style={{ width: 6, height: 6, borderRadius: 'var(--radius-full)', background: 'var(--brand)', animation: 'pulse 1.8s ease-in-out infinite' }} />
      )}
      {isBuilding ? 'Building…' : `Build ${toBuild}`}
    </button>
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
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-card)', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Rollup readiness</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          live probe · each game's rollup cubes from its model
        </span>
        <span style={{ display: 'inline-flex', gap: 10, marginLeft: 4 }}>
          <LegendDot status="built" label="built" />
          <LegendDot status="from-source" label="from source" />
          <LegendDot status="unbuilt" label="unbuilt" />
          <LegendDot status="error" label="error" />
        </span>
        {generatedAt && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
            probed {new Date(generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      <div>
        {games.map((g, i) => {
          const cubes = g.cubes ?? [];
          return (
            <div
              key={g.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '10px 16px',
                borderTop: i === 0 ? 'none' : '1px solid var(--border-card)',
              }}
            >
              {/* Game identity column — fixed width so every row aligns and the
                  game list reads vertically even while chips wrap. */}
              <div style={{ width: 150, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{g.id}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{g.label}</span>
                {cubes.length > 0 && (
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                    {g.built}/{cubes.length} built
                  </span>
                )}
              </div>

              <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 1 }}>
                {cubes.length === 0 ? (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>
                ) : (
                  cubes.map((c) => <CubeChip key={c.cube} result={c} />)
                )}
              </div>

              {triggerEnabled && (
                <div style={{ flexShrink: 0, paddingTop: 1 }}>
                  <BuildAction game={g} buildingGame={buildingGame} onBuild={onBuild} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
