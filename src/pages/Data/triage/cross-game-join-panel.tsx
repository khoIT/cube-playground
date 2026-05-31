/**
 * Cross-game join panel — the builder affordance for joining a cube to one in
 * ANOTHER game under the same Trino connector (executable: shared data_source,
 * Trino federates schemas). The user picks a granted target game, a target cube,
 * the join keys, and the relationship; we POST to /cross-game-join, which
 * dual-grant-checks and stages the join on the draft.
 *
 * Cross-`dataSource` links are out of scope here — the server refuses a
 * non-Trino initiating connector (those are declared+flagged in Phase C).
 */
import { ReactElement, useEffect, useMemo, useState } from 'react';
import { Link2, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { onboardingClient } from '../../../api/onboarding-client';
import type { ExistingCube } from '../../../api/onboarding-client';

type Relationship = 'many_to_one' | 'one_to_many' | 'one_to_one';

interface Props {
  draftId: number;
  currentGame: string;
  /** Dimension names on the initiating cube (join-key candidates). */
  fromColumns: string[];
  /** Games the user may target (already grant-filtered); current game excluded here. */
  allowedGames: string[];
  canWrite: boolean;
  onAdded: () => void;
}

const labelCss: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 };
const fieldCss: React.CSSProperties = { marginBottom: 12 };
const controlCss: React.CSSProperties = {
  height: 34,
  width: '100%',
  padding: '0 10px',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-app)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
};

export function CrossGameJoinPanel({ draftId, currentGame, fromColumns, allowedGames, canWrite, onAdded }: Props): ReactElement {
  const targets = useMemo(() => allowedGames.filter((g) => g !== currentGame), [allowedGames, currentGame]);
  const [targetGame, setTargetGame] = useState<string>(targets[0] ?? '');
  const [cubes, setCubes] = useState<ExistingCube[]>([]);
  const [targetCube, setTargetCube] = useState<string>('');
  const [fromColumn, setFromColumn] = useState<string>(fromColumns[0] ?? '');
  const [toColumn, setToColumn] = useState<string>('');
  const [relationship, setRelationship] = useState<Relationship>('many_to_one');
  const [loadingCubes, setLoadingCubes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Load candidate cubes for the chosen target game.
  useEffect(() => {
    if (!targetGame) {
      setCubes([]);
      return;
    }
    let alive = true;
    setLoadingCubes(true);
    setError(null);
    onboardingClient
      .exampleModel(targetGame)
      .then((m) => {
        if (!alive) return;
        setCubes(m.cubes);
        setTargetCube(m.cubes[0]?.name ?? '');
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoadingCubes(false));
    return () => {
      alive = false;
    };
  }, [targetGame]);

  const targetCubeObj = cubes.find((c) => c.name === targetCube) ?? null;
  const toColumns = targetCubeObj ? targetCubeObj.dimensions.map((d) => d.name) : [];
  const ready = canWrite && !!targetGame && !!targetCube && !!fromColumn && !!toColumn && !busy;

  async function add() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await onboardingClient.crossGameJoin({ draftId, targetGame, targetCube, fromColumn, toColumn, relationship });
      setOk(`Joined ${targetCube} (${targetGame}). The join is staged on the draft.`);
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (targets.length === 0) {
    return (
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
        No other granted games to join. A cross-game join needs grants for both this game and the target.
      </p>
    );
  }

  return (
    <div>
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--text-muted)' }}>
        Join a cube from another game under the same Trino connector — executable because both share one
        <code style={{ margin: '0 4px' }}>data_source</code> and Trino federates schemas.
      </p>

      <div style={fieldCss}>
        <label style={labelCss}>Target game</label>
        <select style={controlCss} value={targetGame} onChange={(e) => setTargetGame(e.target.value)}>
          {targets.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>

      <div style={fieldCss}>
        <label style={labelCss}>Target cube</label>
        <select style={controlCss} value={targetCube} onChange={(e) => setTargetCube(e.target.value)} disabled={loadingCubes || cubes.length === 0}>
          {loadingCubes ? (
            <option>Loading…</option>
          ) : cubes.length === 0 ? (
            <option value="">No cubes in {targetGame}</option>
          ) : (
            cubes.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))
          )}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ ...fieldCss, flex: 1 }}>
          <label style={labelCss}>This cube’s key</label>
          <select style={controlCss} value={fromColumn} onChange={(e) => setFromColumn(e.target.value)}>
            {fromColumns.length === 0 ? <option value="">(no dimensions)</option> : null}
            {fromColumns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div style={{ ...fieldCss, flex: 1 }}>
          <label style={labelCss}>Target cube’s key</label>
          <select style={controlCss} value={toColumn} onChange={(e) => setToColumn(e.target.value)} disabled={toColumns.length === 0}>
            {toColumns.length === 0 ? <option value="">(no dimensions)</option> : null}
            {toColumns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={fieldCss}>
        <label style={labelCss}>Relationship</label>
        <select style={controlCss} value={relationship} onChange={(e) => setRelationship(e.target.value as Relationship)}>
          <option value="many_to_one">many_to_one</option>
          <option value="one_to_many">one_to_many</option>
          <option value="one_to_one">one_to_one</option>
        </select>
      </div>

      {error ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'var(--destructive-soft)', color: 'var(--destructive-ink)', fontSize: 12.5, marginBottom: 10 }}>
          <AlertTriangle size={15} /> {error}
        </div>
      ) : null}
      {ok ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'var(--success-soft)', color: 'var(--success-ink)', fontSize: 12.5, marginBottom: 10 }}>
          <CheckCircle2 size={15} /> {ok}
        </div>
      ) : null}

      <button
        type="button"
        onClick={add}
        disabled={!ready}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: 'none',
          background: 'var(--brand)', color: 'var(--text-on-brand, #fff)',
          fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600,
          cursor: ready ? 'pointer' : 'not-allowed', opacity: ready ? 1 : 0.5,
        }}
      >
        {busy ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />} Add cross-game join
      </button>
    </div>
  );
}
