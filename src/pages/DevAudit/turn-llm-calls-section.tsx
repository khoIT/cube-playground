/**
 * LlmCallsSection — table of LLM calls within a turn, with expandable content_json.
 * Phase-02: Stop column now renders a colored StopReasonPill instead of plain text.
 */
import React, { useState } from 'react';
import { T } from '../../shell/theme';
import type { LlmCall } from './use-debug-api';
import { StopReasonPill } from './stop-reason-pill';

const td: React.CSSProperties = { padding: '3px 6px', borderBottom: `1px solid var(--shell-bg-subtle)`, verticalAlign: 'top' };
const th: React.CSSProperties = { textAlign: 'left', padding: '3px 6px', borderBottom: `1px solid var(--shell-border)`, color: 'var(--shell-text-subtle)', fontWeight: 600 };
const pre: React.CSSProperties = {
  fontFamily: T.fMono, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
  maxHeight: 300, overflowY: 'auto', background: 'var(--surface-subtle)',
  padding: '8px 10px', borderRadius: 4, border: `1px solid var(--shell-border)`,
};
const toggleBtn: React.CSSProperties = {
  fontSize: 11, padding: '2px 8px', border: `1px solid var(--shell-border-strong)`,
  borderRadius: 4, background: 'var(--surface-subtle)', color: 'var(--shell-text-muted)', cursor: 'pointer',
};

function prettyJson(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}

interface LlmCallsSectionProps {
  calls: LlmCall[];
}

export function LlmCallsSection({ calls }: LlmCallsSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (calls.length === 0) {
    return <div style={{ color: 'var(--shell-text-faint)', fontSize: 11 }}>No LLM calls recorded.</div>;
  }

  return (
    <>
      <div style={{ color: 'var(--shell-text-faint)', fontSize: 10, marginBottom: 4 }}>
        Per-call tokens / cost not exposed by the Agent SDK — see turn header for aggregate.
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            {['Step', 'Model', 'ms', 'Stop', 'Content'].map((h) => (
              <th key={h} style={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => (
            <React.Fragment key={c.id}>
              <tr>
                <td style={td}>{c.step_index}</td>
                <td style={{ ...td, fontFamily: T.fMono }}>{c.model ?? '—'}</td>
                <td style={td}>{c.latency_ms ?? '—'}</td>
                <td style={td}><StopReasonPill value={c.stop_reason} /></td>
                <td style={td}>
                  {c.content_json && (
                    <button style={toggleBtn} onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}>
                      {expandedId === c.id ? 'Hide' : 'Show'}
                    </button>
                  )}
                </td>
              </tr>
              {expandedId === c.id && c.content_json && (
                <tr><td colSpan={5} style={td}><pre style={pre}>{prettyJson(c.content_json)}</pre></td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </>
  );
}
