/**
 * AdvisorAuditPanel — admin observability console for the in-process Optimization
 * Advisor agent. Every run/turn/tool-call/cost is persisted (migration 055); this
 * panel reads it back so failure modes (esp. cold-Trino timeouts) are debuggable.
 *
 * 3-pane layout mirroring cross-user-audit-panel.tsx density:
 *   Left  : filters (owner / game / stop reason / free-text q)
 *   Middle: run list — failure runs badged with their stop reason
 *   Right : run detail (turns, tool calls, event replay, failure hint)
 *
 * Cross-user by nature (the advisor runs in-process, so runs already carry
 * owner) — no ?email= proxy. tokens.css CSS variables only — no hex literals.
 */

import React, { useEffect, useState } from 'react';
import {
  fetchAdvisorRuns,
  fetchAdvisorOwners,
  formatDuration,
  formatEpochMs,
  formatUsd,
  scopeLabel,
  type AdvisorRunSummary,
  type AdvisorRunFilter,
} from './advisor-audit-data';
import { AdvisorRunDetail } from './advisor-audit-run-detail';

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
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  fontSize: 12,
  fontFamily: 'var(--font-sans)',
  color: 'var(--text-primary)',
  background: 'var(--bg-muted)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-md)',
  outline: 'none',
  boxSizing: 'border-box',
};

const STOP_REASONS = ['all', 'end_turn', 'timeout', 'max_turns', 'budget', 'aborted', 'error'];

function StopBadge({ run }: { run: AdvisorRunSummary }) {
  if (!run.hadError || !run.finalStopReason) return null;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 'var(--radius-full)', background: 'var(--destructive-soft)', color: 'var(--destructive-ink)', flexShrink: 0 }}>
      {run.finalStopReason}
    </span>
  );
}

function FilterPane({
  owners,
  filter,
  onChange,
}: {
  owners: string[];
  filter: AdvisorRunFilter;
  onChange: (next: AdvisorRunFilter) => void;
}) {
  return (
    <div style={{ ...card, minWidth: 220, maxWidth: 260, flexShrink: 0 }}>
      <div style={sectionHead}>Filters</div>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={eyebrow}>Owner</span>
          <select style={inputStyle} value={filter.owner ?? ''} onChange={(e) => onChange({ ...filter, owner: e.target.value || undefined })}>
            <option value="">All owners</option>
            {owners.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={eyebrow}>Stop reason</span>
          <select style={inputStyle} value={filter.stopReason ?? 'all'} onChange={(e) => onChange({ ...filter, stopReason: e.target.value })}>
            {STOP_REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={eyebrow}>Game</span>
          <input style={inputStyle} placeholder="e.g. cfm_vn" value={filter.game ?? ''} onChange={(e) => onChange({ ...filter, game: e.target.value || undefined })} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={eyebrow}>Search</span>
          <input style={inputStyle} placeholder="goal / segment / id…" value={filter.q ?? ''} onChange={(e) => onChange({ ...filter, q: e.target.value || undefined })} />
        </label>
      </div>
    </div>
  );
}

function RunList({
  runs,
  loading,
  error,
  selectedId,
  onSelect,
}: {
  runs: AdvisorRunSummary[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div style={{ ...card, width: 320, flexShrink: 0 }}>
      <div style={sectionHead}>
        Runs
        {loading && <span style={mutedText}>loading…</span>}
      </div>
      {error && (
        <div style={{ padding: '10px 14px' }}>
          <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'var(--destructive-soft)', color: 'var(--destructive-ink)', fontSize: 13 }}>Error: {error}</div>
        </div>
      )}
      {!error && runs.length === 0 && !loading && <div style={{ padding: '14px', ...mutedText }}>No advisor runs match.</div>}
      <div style={{ overflowY: 'auto', maxHeight: '70vh' }}>
        {runs.map((run) => {
          const selected = run.sessionId === selectedId;
          return (
            <button
              key={run.sessionId}
              type="button"
              onClick={() => onSelect(run.sessionId)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                width: '100%',
                textAlign: 'left',
                padding: '11px 14px',
                border: 'none',
                borderBottom: '1px solid var(--border-card)',
                background: selected ? 'var(--bg-muted)' : 'transparent',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: selected ? 'var(--brand)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {run.goal}
                </span>
                <StopBadge run={run} />
              </div>
              <div style={{ ...mutedText, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span>{scopeLabel(run)}</span>
                <span>· {run.turnCount}t</span>
                <span>· {formatUsd(run.totalCostUsd)}</span>
              </div>
              <div style={{ ...mutedText, fontSize: 11 }}>
                {run.owner ?? '—'} · {formatEpochMs(run.createdAt)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AdvisorAuditPanel() {
  const [owners, setOwners] = useState<string[]>([]);
  const [filter, setFilter] = useState<AdvisorRunFilter>({ stopReason: 'all' });
  const [runs, setRuns] = useState<AdvisorRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetchAdvisorOwners().then(setOwners).catch(() => setOwners([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    // Debounce free-text so each keystroke doesn't fire a request.
    const handle = setTimeout(() => {
      fetchAdvisorRuns(filter)
        .then((r) => {
          setRuns(r);
          setLoading(false);
        })
        .catch((err: Error) => {
          setError(err.message);
          setLoading(false);
        });
    }, 250);
    return () => clearTimeout(handle);
  }, [filter]);

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', fontFamily: 'var(--font-sans)', paddingTop: 16 }}>
      <FilterPane owners={owners} filter={filter} onChange={setFilter} />
      <RunList runs={runs} loading={loading} error={error} selectedId={selectedId} onSelect={setSelectedId} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {selectedId ? (
          <AdvisorRunDetail sessionId={selectedId} />
        ) : (
          <div style={{ ...card, padding: '48px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Select a run to inspect</div>
            <div style={{ ...mutedText, maxWidth: 420, marginInline: 'auto', lineHeight: 1.6 }}>
              Every advisor investigation is recorded — turns, tool calls, durations, cost, and the full SSE event stream.
              Filter by stop reason to find timed-out or failed runs and see an actionable next-step hint.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdvisorAuditPanel;
