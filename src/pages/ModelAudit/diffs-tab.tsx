/**
 * Diffs tab — two modes sharing one DiffViewer:
 *   (a) Dev ↔ Prod: structured + text diff of a cube's dev YAML vs its prod-clone
 *       oracle (from the selected run's snapshots); flags no-counterpart cubes.
 *   (b) Versions: diff a cube's dev YAML between two recorded runs.
 * Game/cube pickers are seeded from the selected run; deep-links from the
 * Findings drawer arrive as ?game=&cube=.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useModelAuditContext } from './model-audit-context';
import { useRunDetail, useDevVsProdDiff, useVersionDiff, useCubeVersions } from './use-model-audit-api';
import { DiffViewer } from './diff-viewer';
import { relativeTime } from './model-audit-format';

type Mode = 'dev-vs-prod' | 'versions';

const selectStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  padding: '4px 8px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-card)',
  background: 'var(--bg-card)',
  color: 'var(--text-primary)',
};

function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DiffsTab() {
  const { selectedRunId } = useModelAuditContext();
  const detail = useRunDetail(selectedRunId);
  const location = useLocation();

  const cubes = detail.data?.cubes ?? [];
  const games = useMemo(() => [...new Set(cubes.map((c) => c.game))].sort(), [cubes]);

  const [mode, setMode] = useState<Mode>('dev-vs-prod');
  const [game, setGame] = useState('');
  const [cube, setCube] = useState('');

  // Seed game/cube from a deep-link (?game=&cube=) once, then from the run.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const g = params.get('game');
    const c = params.get('cube');
    if (g) setGame(g);
    if (c) setCube(c);
  }, [location.search]);

  useEffect(() => {
    if (!game && games.length) setGame(games[0]);
  }, [games, game]);

  const cubesForGame = useMemo(
    () => cubes.filter((c) => c.game === game).map((c) => c.cube).sort(),
    [cubes, game],
  );
  useEffect(() => {
    if (game && cubesForGame.length && !cubesForGame.includes(cube)) setCube(cubesForGame[0]);
  }, [game, cubesForGame, cube]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'inline-flex', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-card)', overflow: 'hidden' }}>
          {(['dev-vs-prod', 'versions'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '6px 12px',
                border: 'none',
                cursor: 'pointer',
                background: mode === m ? 'var(--brand)' : 'var(--bg-card)',
                color: mode === m ? 'var(--text-on-brand)' : 'var(--text-secondary)',
              }}
            >
              {m === 'dev-vs-prod' ? 'Dev ↔ Prod' : 'Versions'}
            </button>
          ))}
        </div>
        <Picker label="Game" value={game} options={games.map((g) => ({ value: g, label: g }))} onChange={setGame} />
        <Picker label="Cube" value={cube} options={cubesForGame.map((c) => ({ value: c, label: c }))} onChange={setCube} />
      </div>

      {!game || !cube ? (
        <div style={muted}>Pick a game and cube to diff.</div>
      ) : mode === 'dev-vs-prod' ? (
        <DevVsProdView game={game} cube={cube} />
      ) : (
        <VersionsView game={game} cube={cube} />
      )}
    </div>
  );
}

function DevVsProdView({ game, cube }: { game: string; cube: string }) {
  const { data, error, isLoading } = useDevVsProdDiff(game, cube);
  if (isLoading) return <div style={muted}>Loading diff…</div>;
  if (error) return <div style={errorStyle}>{error}</div>;
  if (!data) return <div style={muted}>No diff.</div>;
  if (data.noCounterpart) {
    return (
      <div style={{ ...muted, color: 'var(--warning-ink)' }}>
        <strong>{cube}</strong> has no oracle counterpart in this run — dev-only cube. Nothing to compare against prod.
      </div>
    );
  }
  return (
    <DiffViewer
      structured={data.structured}
      text={data.text}
      beforeLabel={data.prodPath ?? 'oracle'}
      afterLabel={data.devPath ?? 'dev'}
    />
  );
}

function VersionsView({ game, cube }: { game: string; cube: string }) {
  const { data: versionsData } = useCubeVersions(game, cube);
  const versions = versionsData?.versions ?? [];
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);

  useEffect(() => {
    if (versions.length >= 2) {
      setFrom(versions[versions.length - 2].runId);
      setTo(versions[versions.length - 1].runId);
    } else if (versions.length === 1) {
      setFrom(versions[0].runId);
      setTo(versions[0].runId);
    }
  }, [versionsData]); // eslint-disable-line react-hooks/exhaustive-deps

  const diff = useVersionDiff(game, cube, from, to);
  const opts = versions.map((v) => ({
    value: String(v.runId),
    label: `#${v.runId} · ${relativeTime(v.startedAt)}${v.changed ? ' ✦' : ''}`,
  }));

  if (versions.length < 2) {
    return <div style={muted}>Only one recorded version of this cube — run the audit again after a change to compare.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <Picker label="From" value={String(from ?? '')} options={opts} onChange={(v) => setFrom(Number(v))} />
        <Picker label="To" value={String(to ?? '')} options={opts} onChange={(v) => setTo(Number(v))} />
      </div>
      {diff.isLoading ? (
        <div style={muted}>Loading diff…</div>
      ) : diff.error ? (
        <div style={errorStyle}>{diff.error}</div>
      ) : diff.data ? (
        <DiffViewer
          structured={diff.data.structured}
          text={diff.data.text}
          beforeLabel={`run #${diff.data.fromRunId}`}
          afterLabel={`run #${diff.data.toRunId}`}
        />
      ) : (
        <div style={muted}>No diff.</div>
      )}
    </div>
  );
}

const muted: React.CSSProperties = { fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' };
const errorStyle: React.CSSProperties = { fontSize: 13, color: 'var(--destructive-ink)', padding: '16px 0' };
