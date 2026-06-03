/**
 * AuditLogViewer — filterable table over the access-management audit log
 * (GET /api/admin/audit) with CSV export.
 *
 * Export hardening:
 *   - The fetch behind useAuditLog is admin-gated server-side, so export is
 *     re-validated at request time (not just at page load).
 *   - Exporting emits an `export` activity event (self-audit of who pulled the
 *     log) via recordExport.
 *   - The CSV detail column carries only grant-change payloads — no query
 *     filter values or UIDs (guaranteed by the access-audit writer).
 *
 * tokens.css only.
 */

import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { recordExport } from '../../../api/feature-open-beacon';
import {
  useAuditLog,
  auditEntriesToCsv,
  type AuditEntry,
  type AuditFilters,
} from './observability-data';

const card: React.CSSProperties = {
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-card)',
  overflow: 'hidden',
};

const input: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12.5, fontFamily: 'var(--font-sans)',
  color: 'var(--text-primary)', background: 'var(--bg-app)',
  border: '1px solid var(--border-card)', borderRadius: 'var(--radius-sm)',
  minWidth: 0,
};

const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.04em', color: 'var(--text-muted)', padding: '8px 12px',
  borderBottom: '1px solid var(--border-card)',
};

const td: React.CSSProperties = {
  fontSize: 12.5, color: 'var(--text-secondary)', padding: '8px 12px',
  borderBottom: '1px solid var(--border-card)', verticalAlign: 'top',
};

/** Triggers a client-side CSV download. Isolated so tests can stub it. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AuditLogViewer() {
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');

  // The filters object is rebuilt only when a field actually changes, so the
  // hook's refetch isn't triggered on every keystroke-driven re-render.
  const filters: AuditFilters = useMemo(
    () => ({ actor: actor || undefined, action: action || undefined, target: target || undefined, limit: 500 }),
    [actor, action, target],
  );

  const { entries, loading, error } = useAuditLog(filters);

  function exportCsv() {
    recordExport('audit_log'); // self-audit: record who pulled the log
    downloadCsv('access-audit.csv', auditEntriesToCsv(entries));
  }

  return (
    <section style={{ ...card, marginTop: 16 }}>
      <header
        style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '12px 14px', borderBottom: '1px solid var(--border-card)',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginRight: 'auto' }}>
          Audit log
        </span>
        <input style={input} placeholder="actor…" aria-label="Filter by actor" value={actor} onChange={(e) => setActor(e.target.value)} />
        <input style={input} placeholder="action…" aria-label="Filter by action" value={action} onChange={(e) => setAction(e.target.value)} />
        <input style={input} placeholder="target…" aria-label="Filter by target" value={target} onChange={(e) => setTarget(e.target.value)} />
        <button
          type="button"
          onClick={exportCsv}
          disabled={entries.length === 0}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'var(--bg-muted)', color: 'var(--text-secondary)',
            border: '1px solid var(--border-card)', borderRadius: 'var(--radius-sm)',
            padding: '6px 12px', fontSize: 12, fontWeight: 600,
            cursor: entries.length === 0 ? 'default' : 'pointer',
            opacity: entries.length === 0 ? 0.5 : 1, fontFamily: 'var(--font-sans)',
          }}
        >
          <Download size={13} /> Export CSV
        </button>
      </header>

      {error && (
        <div style={{ padding: '10px 14px', fontSize: 12.5, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)' }}>
          {error}
        </div>
      )}

      {!error && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Actor</th>
                <th style={th}>Action</th>
                <th style={th}>Target</th>
                <th style={th}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && !loading && (
                <tr>
                  <td style={{ ...td, color: 'var(--text-muted)' }} colSpan={5}>
                    No audit entries match these filters.
                  </td>
                </tr>
              )}
              {entries.map((e: AuditEntry) => (
                <tr key={e.id}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{e.ts}</td>
                  <td style={td}>{e.actorEmail}</td>
                  <td style={td}><code style={{ fontSize: 11.5 }}>{e.action}</code></td>
                  <td style={td}>{e.targetEmail}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }}>
                    {e.detail == null ? '—' : JSON.stringify(e.detail)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
