/**
 * AdvisorRunDetail — right pane of the advisor audit console.
 *
 * Renders one run: header meta, an actionable failure-hint banner, a turn
 * timeline (narration + tool-call rows with state badge / duration / error),
 * and a lazy, paginated SSE event replay per turn.
 *
 * tokens.css CSS variables only — no hex literals.
 */

import React, { useEffect, useState } from 'react';
import {
  fetchAdvisorRunDetail,
  fetchAdvisorRunEvents,
  formatDuration,
  formatEpochMs,
  formatUsd,
  scopeLabel,
  type AdvisorRunDetail as RunDetail,
  type AdvisorToolCall,
  type AdvisorEvent,
} from './advisor-audit-data';
import { failureHint, collectToolOutcomes } from './advisor-failure-hints';

const card: React.CSSProperties = {
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-card)',
  overflow: 'hidden',
};
const sectionHead: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid var(--border-card)',
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--text-primary)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};
const eyebrow: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
};
const mutedText: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)' };
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11.5 };

function StateBadge({ state }: { state: string }) {
  const palette: Record<string, { bg: string; ink: string }> = {
    ok: { bg: 'var(--success-soft)', ink: 'var(--success-ink)' },
    failed: { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)' },
    denied: { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
  };
  const c = palette[state] ?? { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)' };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 'var(--radius-full)', background: c.bg, color: c.ink }}>
      {state}
    </span>
  );
}

function ToolCallRow({ call }: { call: AdvisorToolCall }) {
  return (
    <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border-card)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StateBadge state={call.state} />
        <span style={{ ...mono, color: 'var(--text-primary)', fontWeight: 600 }}>{call.tool}</span>
        <span style={{ ...mutedText, marginLeft: 'auto' }}>{formatDuration(call.durationMs)}</span>
      </div>
      {call.inputJson && (
        <div style={{ ...mono, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {call.inputJson.length > 300 ? `${call.inputJson.slice(0, 300)}…` : call.inputJson}
        </div>
      )}
      {call.errorMessage && (
        <div style={{ fontSize: 12, color: 'var(--destructive-ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {call.errorMessage}
        </div>
      )}
    </div>
  );
}

function EventReplay({ sessionId, turnIndex }: { sessionId: string; turnIndex: number }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<AdvisorEvent[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  function load(fromCursor?: number) {
    setLoading(true);
    fetchAdvisorRunEvents(sessionId, { turnIndex, cursor: fromCursor, limit: 100 })
      .then((res) => {
        setEvents((prev) => (fromCursor != null && prev ? [...prev, ...res.events] : res.events));
        setCursor(res.nextCursor);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  return (
    <div style={{ borderTop: '1px solid var(--border-card)' }}>
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && events == null) load();
        }}
        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 14px', border: 'none', background: 'var(--bg-muted)', cursor: 'pointer', ...eyebrow }}
      >
        {open ? '▾' : '▸'} SSE event replay
      </button>
      {open && (
        <div style={{ padding: '6px 14px 10px' }}>
          {loading && !events && <div style={mutedText}>Loading…</div>}
          {events?.map((e) => (
            <div key={e.id} style={{ ...mono, color: 'var(--text-secondary)', padding: '2px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              <span style={{ color: 'var(--brand)', fontWeight: 600 }}>{e.eventType}</span> {e.eventJson}
            </div>
          ))}
          {cursor != null && (
            <button type="button" onClick={() => load(cursor)} style={{ marginTop: 6, ...eyebrow, background: 'none', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-md)', padding: '3px 10px', cursor: 'pointer' }}>
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function AdvisorRunDetail({ sessionId }: { sessionId: string }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setLoading(true);
    fetchAdvisorRunDetail(sessionId)
      .then((d) => {
        setDetail(d);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [sessionId]);

  if (loading) return <div style={{ ...card, flex: 1, padding: 14, ...mutedText }}>Loading run…</div>;
  if (error)
    return (
      <div style={{ ...card, flex: 1, padding: 14 }}>
        <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'var(--destructive-soft)', color: 'var(--destructive-ink)', fontSize: 13 }}>Error: {error}</div>
      </div>
    );
  if (!detail) return null;

  const { run, turns } = detail;
  const outcomes = collectToolOutcomes(turns);
  const hint = failureHint({ stopReason: run.finalStopReason, abortCause: turns[turns.length - 1]?.abortCause, ...outcomes });

  return (
    <div style={{ ...card, flex: 1, minWidth: 0 }}>
      <div style={sectionHead}>
        <span>{run.goal} · {scopeLabel(run)}</span>
        <span style={mutedText}>{run.turnCount} turn{run.turnCount !== 1 ? 's' : ''}</span>
      </div>

      {/* Meta row */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-card)', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {[
          ['Owner', run.owner ?? '—'],
          ['Model', run.model ?? '—'],
          ['Total cost', formatUsd(run.totalCostUsd)],
          ['Stop', run.finalStopReason ?? '—'],
          ['Started', formatEpochMs(run.createdAt)],
        ].map(([label, value]) => (
          <div key={label}>
            <div style={eyebrow}>{label}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Failure-hint banner */}
      {hint && (
        <div
          style={{
            margin: '10px 14px',
            padding: '10px 12px',
            borderRadius: 'var(--radius-md)',
            background: hint.severity === 'error' ? 'var(--destructive-soft)' : 'var(--info-soft)',
            color: hint.severity === 'error' ? 'var(--destructive-ink)' : 'var(--info-ink)',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>{hint.title}</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{hint.hint}</div>
        </div>
      )}

      {/* Turn timeline */}
      {turns.map((turn) => (
        <div key={turn.id} style={{ borderTop: '1px solid var(--border-card)' }}>
          <div style={{ padding: '9px 14px', display: 'flex', alignItems: 'baseline', gap: 8, background: 'var(--bg-muted)' }}>
            <span style={{ ...eyebrow, fontSize: 11 }}>Turn {turn.turnIndex}</span>
            <span style={mutedText}>{turn.mode}</span>
            <span style={{ ...mutedText, marginLeft: 'auto' }}>{formatDuration(turn.durationMs)} · {formatUsd(turn.costUsd)} · {turn.stopReason}</span>
          </div>
          {turn.message && (
            <div style={{ padding: '8px 14px', fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              <span style={eyebrow}>Prompt </span>
              {turn.message}
            </div>
          )}
          {turn.narration && (
            <div style={{ padding: '0 14px 8px', fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {turn.narration.length > 600 ? `${turn.narration.slice(0, 600)}…` : turn.narration}
            </div>
          )}
          {turn.toolCalls.map((c) => (
            <ToolCallRow key={c.id} call={c} />
          ))}
          <EventReplay sessionId={sessionId} turnIndex={turn.turnIndex} />
        </div>
      ))}
    </div>
  );
}
