/**
 * Phase 4.2 — Cross-game funnel compare.
 *
 * Given the current funnel definition (events + window + cube), POST the
 * same shape to /api/liveops/funnel for an alternate game and render the
 * two step counts side-by-side with delta % per step.
 *
 * Uses the server-side cache, so repeated compares cost ~1 query per game
 * per TTL window.
 */

import { useEffect, useState } from 'react';
import { liveopsClient, type FunnelResultPayload, type LiveopsResponse, type CachedView } from '../../../api/liveops-client';
import type { FunnelStep } from './run-funnel';

interface Props {
  /** Cube name detected for the active game. */
  cubeName: string;
  /** Current game id — used as base for delta calc. */
  baseGameId: string;
  /** Other game ids the playground knows about (from gds.config). */
  candidateGames: Array<{ id: string; name: string }>;
  /** Funnel events + window from the wizard. */
  orderedEvents: string[];
  windowMs: number;
  /** Base game's steps (already computed in StepResult) for the delta. */
  baseSteps: FunnelStep[];
}

function isCached<T>(r: LiveopsResponse<T>): r is CachedView<T> {
  return (r as CachedView<T>).status === 'fresh' || (r as CachedView<T>).status === 'refreshing';
}

export function CrossGameCompare({
  cubeName,
  baseGameId,
  candidateGames,
  orderedEvents,
  windowMs,
  baseSteps,
}: Props) {
  const [otherGame, setOtherGame] = useState<string>('');
  const [other, setOther] = useState<FunnelResultPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [warming, setWarming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!otherGame || otherGame === baseGameId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOther(null);
    setWarming(false);

    const tryFetch = async (attempt = 0) => {
      try {
        const res = await liveopsClient.funnel(otherGame, {
          cubeName, orderedEvents, windowMs,
        });
        if (cancelled) return;
        if (isCached<FunnelResultPayload>(res)) {
          setOther(res.payload);
          setLoading(false);
          setWarming(false);
          return;
        }
        setWarming(true);
        const delay = Math.min(1500 * Math.pow(2, attempt), 10_000);
        setTimeout(() => { if (!cancelled) void tryFetch(attempt + 1); }, delay);
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
        setLoading(false);
      }
    };
    void tryFetch();
    return () => { cancelled = true; };
  }, [otherGame, baseGameId, cubeName, orderedEvents.join('|'), windowMs]);

  const others = candidateGames.filter((g) => g.id !== baseGameId);

  return (
    <div style={{ marginTop: 16, padding: '12px 14px', border: '1px solid var(--border-card)', borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Compare with</span>
        <select
          value={otherGame}
          onChange={(e) => setOtherGame(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border-card)' }}
        >
          <option value="">— pick a game —</option>
          {others.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        {warming && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Warming cache…</span>}
        {loading && !warming && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading…</span>}
        {error && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{error}</span>}
      </div>

      {other && (
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
              <th style={{ padding: '4px 6px' }}>Step</th>
              <th style={{ padding: '4px 6px', textAlign: 'right' }}>{baseGameId}</th>
              <th style={{ padding: '4px 6px', textAlign: 'right' }}>{otherGame}</th>
              <th style={{ padding: '4px 6px', textAlign: 'right' }}>Δ</th>
            </tr>
          </thead>
          <tbody>
            {baseSteps.map((step, i) => {
              const otherStep = other.steps[i];
              const otherCount = otherStep?.count ?? 0;
              const delta = step.count > 0 ? ((otherCount - step.count) / step.count) * 100 : 0;
              return (
                <tr key={step.name} style={{ borderTop: '1px solid var(--border-card)' }}>
                  <td style={{ padding: '4px 6px' }}>{step.name}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {step.count.toLocaleString()}
                  </td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {otherCount.toLocaleString()}
                  </td>
                  <td style={{
                    padding: '4px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                    color: delta > 0 ? 'var(--positive)' : delta < 0 ? 'var(--negative)' : 'var(--text-muted)',
                  }}>
                    {delta === 0 ? '0%' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
