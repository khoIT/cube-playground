/**
 * Read-only replay of one past Drive investigation, shown as a modal overlay.
 * Renders the run as a turn-by-turn transcript: the prompt the user sent, the
 * agent's narration, and which tools ran (with a validated/failed marker — never
 * raw tool I/O). Header carries goal · scope · outcome · cost · date.
 */

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Eyebrow, Pill } from './advisor-primitives';
import { NumberBadge } from './number-badge';
import {
  fetchAdvisorRunReplay,
  type AdvisorRunReplay,
  type AdvisorReplayTurn,
} from '../../api/advisor-run-history';
import { runOutcome, outcomeColors, goalLabel, scopeLabel } from './run-outcome';
import { AdvisorMarkdown } from './advisor-markdown';

function TurnBlock({ turn }: { turn: AdvisorReplayTurn }) {
  return (
    <div style={{ borderTop: '1px solid var(--border-card)', paddingTop: 14, marginTop: 14 }}>
      <Eyebrow style={{ marginBottom: 8 }}>
        {turn.turnIndex === 0 ? 'Investigation' : `Follow-up ${turn.turnIndex}`}
      </Eyebrow>

      {turn.message && (
        <div
          style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            background: 'var(--muted-soft)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 11px',
            marginBottom: 10,
            whiteSpace: 'pre-wrap',
          }}
        >
          {turn.message}
        </div>
      )}

      {turn.narration && (
        <div style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>
          <AdvisorMarkdown>{turn.narration}</AdvisorMarkdown>
        </div>
      )}

      {turn.toolCalls.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Eyebrow style={{ marginBottom: 6 }}>Evidence gathered</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {turn.toolCalls.map((c, i) => (
              <div
                key={`${c.tool}-${i}`}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}
              >
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.tool}</span>
                {c.validated ? (
                  <NumberBadge variant="validated" />
                ) : (
                  <span style={{ color: 'var(--destructive-ink)', fontSize: 11.5 }}>
                    failed / denied
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function RunReplay({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [data, setData] = useState<AdvisorRunReplay | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    fetchAdvisorRunReplay(sessionId)
      .then((res) => alive && setData(res))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [sessionId]);

  // Close on Escape — modal affordance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = data?.run;
  const outcome = run ? runOutcome(run.finalStopReason) : null;
  const colors = outcome ? outcomeColors(outcome.tone) : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: '48px 20px',
        zIndex: 1000,
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Past investigation"
        style={{
          width: '100%',
          maxWidth: 760,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          padding: 24,
          fontFamily: 'var(--font-sans)',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            {run ? goalLabel(run.goal) : 'Investigation'}
          </h2>
          {run && (
            <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
              · {scopeLabel(run.scopeKind, run.gameId, run.segmentId)}
            </span>
          )}
          {outcome && colors && (
            <Pill bg={colors.bg} ink={colors.ink}>
              {outcome.label}
            </Pill>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              padding: 6,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--text-muted)',
            }}
          >
            <X size={18} />
          </button>
        </header>

        {run && (
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '6px 0 0' }}>
            {new Date(run.createdAt).toLocaleString()} · {run.turnCount} turn
            {run.turnCount === 1 ? '' : 's'}
            {run.totalCostUsd > 0 ? ` · ~$${run.totalCostUsd.toFixed(3)}` : ''}
          </p>
        )}

        {error && (
          <div
            style={{
              marginTop: 16,
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--destructive-soft)',
              color: 'var(--destructive-ink)',
              fontSize: 12.5,
            }}
          >
            Could not load this investigation. {error}
          </div>
        )}

        {!error && !data && (
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 16 }}>Loading…</p>
        )}

        {data && data.turns.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 16 }}>
            This investigation has no recorded turns.
          </p>
        )}

        {data && data.turns.map((t) => <TurnBlock key={t.turnIndex} turn={t} />)}
      </div>
    </div>
  );
}
