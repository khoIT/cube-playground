/**
 * Experiments list — browse every persisted experiment for the active game and
 * reopen any of them in the live-monitoring board. Complements reuse-on-revisit
 * (the monitor adopts a segment's running experiment automatically); this is the
 * explicit "show me all my experiments" surface.
 *
 * A row deep-links to `/advisor/{segmentId}?experiment={id}`, which the advisor
 * shell reads to jump straight to the monitor board for that experiment.
 */
import { useEffect, useState } from 'react';
import { listExperiments, type ExperimentSummary, type ExperimentStatus } from '../../api/experiments';
import { Btn, CARD_STYLE, EYEBROW_STYLE, Pill } from './advisor-primitives';

interface Props {
  gameId: string;
  onOpen: (exp: ExperimentSummary) => void;
  onBack: () => void;
}

/** status → semantic soft/ink token pair (dark-mode safe). */
const STATUS_TOKENS: Record<ExperimentStatus, { bg: string; ink: string }> = {
  draft: { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)' },
  running: { bg: 'var(--info-soft)', ink: 'var(--info-ink)' },
  completed: { bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
  archived: { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)' },
};

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

export function ExperimentsList({ gameId, onOpen, onBack }: Props) {
  const [rows, setRows] = useState<ExperimentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    listExperiments(gameId)
      .then((r) => alive && setRows(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'failed to load'));
    return () => {
      alive = false;
    };
  }, [gameId]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div>
          <div style={EYEBROW_STYLE}>📊 Experiments</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
            Every experiment for <b style={{ color: 'var(--text-secondary)' }}>{gameId}</b> — open one
            to view its live treatment-vs-hold-out monitor.
          </div>
        </div>
        <span style={{ marginLeft: 'auto' }}>
          <Btn sm onClick={onBack}>
            ← Back
          </Btn>
        </span>
      </div>

      {error && (
        <div
          style={{
            ...CARD_STYLE,
            padding: '12px 16px',
            color: 'var(--destructive-ink)',
            background: 'var(--destructive-soft)',
            fontSize: 12.5,
          }}
        >
          Couldn't load experiments: {error}
        </div>
      )}

      {!error && rows === null && (
        <div style={{ ...CARD_STYLE, padding: '14px 16px', fontSize: 12.5, color: 'var(--text-muted)' }}>
          Loading experiments…
        </div>
      )}

      {!error && rows?.length === 0 && (
        <div style={{ ...CARD_STYLE, padding: '14px 16px', fontSize: 12.5, color: 'var(--text-muted)' }}>
          No experiments yet for {gameId}. Walk a segment through the Advisor and freeze the groups to
          create one.
        </div>
      )}

      {!error && rows && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((exp) => {
            const tok = STATUS_TOKENS[exp.status];
            return (
              <button
                key={exp.id}
                onClick={() => onOpen(exp)}
                style={{
                  ...CARD_STYLE,
                  fontFamily: 'var(--font-sans)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {exp.name}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                    {exp.arms.treatment.toLocaleString()} treatment ·{' '}
                    {exp.arms.control.toLocaleString()} hold-out · {exp.windowDays}d window ·{' '}
                    {exp.assignedAt ? `frozen ${fmtDate(exp.assignedAt)}` : `created ${fmtDate(exp.createdAt)}`}
                  </div>
                </div>
                <Pill bg={tok.bg} ink={tok.ink}>
                  {exp.status}
                </Pill>
                <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>→</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
