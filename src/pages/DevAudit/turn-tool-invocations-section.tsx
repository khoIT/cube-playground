/**
 * ToolInvocationsSection — table of tool invocations within a turn, with expandable args.
 */
import React, { useState } from 'react';
import { T } from '../../shell/theme';
import type { ToolInvocation } from './use-debug-api';

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

interface ToolInvocationsSectionProps {
  invocations: ToolInvocation[];
}

export function ToolInvocationsSection({ invocations }: ToolInvocationsSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (invocations.length === 0) {
    return <div style={{ color: 'var(--shell-text-faint)', fontSize: 11 }}>No tool invocations recorded.</div>;
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
      <thead>
        <tr>
          {['Tool', 'Ok', 'ms', 'Summary', 'Args'].map((h) => (
            <th key={h} style={th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {invocations.map((t) => (
          <React.Fragment key={t.id}>
            <tr>
              <td style={{ ...td, fontFamily: T.fMono }}>{t.name}</td>
              <td style={td}>
                <span style={{
                  display: 'inline-block', padding: '1px 5px', borderRadius: 4,
                  fontSize: 10, fontWeight: 700,
                  background: t.ok ? 'var(--shell-success-soft)' : 'var(--shell-danger-soft)',
                  color: t.ok ? 'var(--shell-success)' : 'var(--shell-danger-strong)',
                }}>
                  {t.ok ? 'ok' : 'err'}
                </span>
              </td>
              <td style={td}>{t.latency_ms ?? '—'}</td>
              <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.result_summary ?? '—'}
              </td>
              <td style={td}>
                {t.args_json && (
                  <button style={toggleBtn} onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                    {expandedId === t.id ? 'Hide' : 'Args'}
                  </button>
                )}
              </td>
            </tr>
            {expandedId === t.id && t.args_json && (
              <tr><td colSpan={5} style={td}><pre style={pre}>{prettyJson(t.args_json)}</pre></td></tr>
            )}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}
