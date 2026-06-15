/**
 * "Recent investigations" — a collapsible list of the signed-in user's own past
 * Drive runs. Each row opens a read-only replay. Data comes from the owner-scoped
 * GET /api/advisor/runs, so a user only ever sees their own runs.
 */

import React, { useEffect, useState } from 'react';
import { History, ChevronRight } from 'lucide-react';
import { CARD_STYLE, Eyebrow, Pill } from './advisor-primitives';
import { fetchMyAdvisorRuns, type AdvisorRunListItem } from '../../api/advisor-run-history';
import { runOutcome, outcomeColors, relativeTime, goalLabel, scopeLabel } from './run-outcome';

/** Bumping this forces a re-fetch (e.g. after a live run finishes). */
export function RunHistoryPanel({
  reloadKey = 0,
  onOpen,
}: {
  reloadKey?: number;
  onOpen: (sessionId: string) => void;
}) {
  const [runs, setRuns] = useState<AdvisorRunListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    fetchMyAdvisorRuns()
      .then((res) => alive && setRuns(res.runs))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // Nothing to show (no history yet, or signed-out) — stay quiet, don't clutter.
  if (error || (runs && runs.length === 0)) return null;

  return (
    <div style={{ ...CARD_STYLE, padding: 20, marginTop: 16 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <History size={16} color="var(--text-secondary)" aria-hidden />
        <Eyebrow>Recent investigations</Eyebrow>
        {runs && (
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
            {runs.length} run{runs.length === 1 ? '' : 's'}
          </span>
        )}
      </header>

      {runs === null ? (
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>Loading…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {runs.map((r) => {
            const outcome = runOutcome(r.finalStopReason);
            const colors = outcomeColors(outcome.tone);
            return (
              <button
                key={r.sessionId}
                type="button"
                onClick={() => onOpen(r.sessionId)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  textAlign: 'left',
                  padding: '9px 11px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-card)',
                  background: 'var(--bg-card)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                  {goalLabel(r.goal)}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {scopeLabel(r.scopeKind, r.gameId, r.segmentId)}
                </span>
                <Pill bg={colors.bg} ink={colors.ink}>
                  {outcome.label}
                </Pill>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {r.turnCount} turn{r.turnCount === 1 ? '' : 's'} · {relativeTime(r.createdAt)}
                </span>
                <ChevronRight size={15} color="var(--text-muted)" aria-hidden />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
