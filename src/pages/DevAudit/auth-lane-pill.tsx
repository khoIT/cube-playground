/**
 * AuthLanePill — one-word session-header pill showing which auth lane served
 * the session's latest assistant turn ('Primary'|'Stg'|'Backup'|'Subscription').
 *
 * Lane is recorded per turn in chat_turns.llm_auth_label by the key-failover
 * ladder; the pill reflects the most recent non-null label so a session that
 * failed over mid-way shows where it ended up. Tooltip lists the full lane
 * history when more than one lane was used. Hidden when no turn carries a
 * label (legacy sessions).
 */
import React from 'react';
import { T } from '../../shell/theme';
import type { DebugTurn } from './use-debug-api-types';

/** Display word + colors per lane. Unknown labels fall back to neutral. */
const LANE_STYLE: Record<string, { word: string; bg: string; ink: string }> = {
  primary: { word: 'Primary', bg: 'var(--shell-success-soft)', ink: 'var(--shell-success)' },
  stg: { word: 'Stg', bg: 'var(--shell-warning-soft)', ink: 'var(--shell-warning)' },
  backup: { word: 'Backup', bg: 'var(--shell-warning-soft)', ink: 'var(--shell-warning)' },
  subscription: { word: 'Subscription', bg: 'var(--shell-info-soft)', ink: 'var(--shell-info)' },
};

/**
 * Latest non-null lane label across assistant turns (turns arrive in
 * chronological order, so the last labelled one is the session's final lane).
 */
export function resolveSessionAuthLane(turns: DebugTurn[]): {
  lane: string;
  history: string[];
} | null {
  const labels = turns
    .filter((t) => t.role === 'assistant' && t.llmAuthLabel)
    .map((t) => t.llmAuthLabel as string);
  if (labels.length === 0) return null;
  // Distinct lanes in first-used order — tooltip shows the failover path.
  const history = labels.filter((l, i) => labels.indexOf(l) === i);
  return { lane: labels[labels.length - 1]!, history };
}

export function AuthLanePill({ turns }: { turns: DebugTurn[] }) {
  const resolved = resolveSessionAuthLane(turns);
  if (!resolved) return null;

  const style = LANE_STYLE[resolved.lane] ?? {
    word: resolved.lane,
    bg: 'var(--surface-muted)',
    ink: 'var(--shell-text-muted)',
  };
  const title =
    resolved.history.length > 1
      ? `Auth lane history: ${resolved.history.join(' → ')}`
      : `All turns served via the ${style.word.toLowerCase()} auth lane`;

  return (
    <span
      data-testid="auth-lane-pill"
      title={title}
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: '1px 8px',
        borderRadius: 999,
        border: `1px solid ${style.ink}`,
        background: style.bg,
        color: style.ink,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      {style.word}
    </span>
  );
}
