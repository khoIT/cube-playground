/**
 * Drive panel — the live agent investigation posture. The manager states a goal
 * in plain language and presses Investigate; the agent streams its reasoning and
 * calls provenanced tools, lighting up the experiment-anatomy stage rail as it
 * goes. Numbers from tool results are validated; spoken numbers are exploratory.
 * Steering = a follow-up turn on the same session.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Lightbulb, Send, Square } from 'lucide-react';
import { STAGES } from './advisor-stage-config';
import { Btn, CARD_STYLE, Eyebrow, PulsingRow } from './advisor-primitives';
import { NumberBadge } from './number-badge';
import { useDriveSession } from './use-drive-session';
import type { AdvisorScope, AdvisorGoal } from '../../api/advisor';
import type { StageKey } from './advisor-types';

const ERROR_COPY: Record<string, string> = {
  oauth_unavailable:
    'The AI investigator is not configured on this server (no subscription token). Backend smoke test: set CLAUDE_CODE_OAUTH_TOKEN on the API process.',
  timeout: 'The investigation took too long and was stopped. Try a narrower question.',
  budget_exceeded: 'This investigation reached its cost cap. Start a fresh one to continue.',
};

function StageRail({ touched }: { touched: StageKey[] }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 14px' }}>
      {STAGES.map((s) => {
        const lit = touched.includes(s.key);
        return (
          <span
            key={s.key}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '5px 11px',
              borderRadius: 'var(--radius-full)',
              border: `1px solid ${lit ? 'var(--brand)' : 'var(--border-card)'}`,
              background: lit ? 'var(--brand-soft, var(--success-soft))' : 'var(--bg-card)',
              color: lit ? 'var(--brand)' : 'var(--text-muted)',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {s.emoji} {s.label}
          </span>
        );
      })}
    </div>
  );
}

export function DrivePanel({
  scope,
  goal,
  goalText,
  onSessionComplete,
}: {
  scope: AdvisorScope;
  goal: AdvisorGoal;
  goalText: string;
  /** Fired when a turn reaches a terminal state, so the caller can refresh run history. */
  onSessionComplete?: () => void;
}) {
  const { state, run, abort } = useDriveSession(scope, goal);
  const seed =
    goalText.trim() ||
    `Investigate how to ${goal === 'engagement' ? 'grow engagement' : 'grow gross revenue'} here and propose one strong experiment.`;
  const [message, setMessage] = useState(seed);
  const streaming = state.status === 'streaming';
  const hasRun = state.status !== 'idle';

  // Notify the parent once per turn when the stream settles (done/error) — the
  // just-finished run is now persisted and should appear in the history list.
  const prevStatus = useRef(state.status);
  useEffect(() => {
    if (
      prevStatus.current === 'streaming' &&
      (state.status === 'done' || state.status === 'error')
    ) {
      onSessionComplete?.();
    }
    prevStatus.current = state.status;
  }, [state.status, onSessionComplete]);

  return (
    <div style={{ ...CARD_STYLE, padding: 20, marginTop: 16 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Lightbulb size={17} color="var(--brand)" aria-hidden />
        <Eyebrow>Drive · live AI investigation</Eyebrow>
        {state.costUsd != null && (
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
            ~${state.costUsd.toFixed(3)} · {streaming ? 'working…' : (state.stopReason ?? 'done')}
          </span>
        )}
      </header>

      <StageRail touched={state.stagesTouched} />

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={2}
        disabled={streaming}
        placeholder="Tell the advisor what to look into…"
        style={{
          width: '100%',
          resize: 'vertical',
          fontFamily: 'var(--font-sans)',
          fontSize: 13.5,
          color: 'var(--text-primary)',
          background: 'var(--bg-input, var(--bg-card))',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 12px',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Btn kind="primary" disabled={streaming || message.trim().length === 0} onClick={() => run(message.trim())}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Send size={14} /> {hasRun ? 'Steer' : 'Investigate'}
          </span>
        </Btn>
        {streaming && (
          <Btn onClick={abort}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Square size={13} /> Stop
            </span>
          </Btn>
        )}
      </div>

      {state.error && (
        <div
          style={{
            marginTop: 14,
            padding: '10px 12px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--destructive-soft)',
            color: 'var(--destructive-ink)',
            fontSize: 12.5,
          }}
        >
          {ERROR_COPY[state.error.code] ?? state.error.message}
        </div>
      )}

      {state.narration && (
        <div
          style={{
            marginTop: 14,
            fontSize: 13.5,
            lineHeight: 1.55,
            color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {state.narration}
          {streaming && <span style={{ color: 'var(--brand)' }}>▋</span>}
        </div>
      )}

      {state.activity.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Eyebrow style={{ marginBottom: 6 }}>Evidence gathered</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {state.activity.map((a, i) => (
              <div key={`${a.tool}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                {a.state === 'running' ? (
                  <PulsingRow>
                    <span style={{ fontWeight: 600 }}>{a.tool}</span> running…
                  </PulsingRow>
                ) : (
                  <>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{a.tool}</span>
                    {a.validated ? (
                      <NumberBadge variant="validated" />
                    ) : (
                      <span style={{ color: 'var(--destructive-ink)', fontSize: 11.5 }}>failed / denied</span>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <p style={{ marginTop: 16, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Numbers from a tool show <NumberBadge variant="validated" /> and are safe to act on. The advisor never launches
        anything — its output is an editable draft you review in the Command Center. Hand-off stays disabled until the
        draft's numbers are validated.
      </p>
    </div>
  );
}
