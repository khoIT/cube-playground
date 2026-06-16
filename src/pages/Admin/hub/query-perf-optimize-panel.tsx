/**
 * Recommendation panel — rendered INLINE inside an expanded failure row.
 *
 * Shows the classifier verdict, the best optimization playbook (+ alternatives),
 * the DRAFT rollup YAML when the remedy scaffolds one (copy-able, with warnings),
 * and — only when no playbook fits (needsLlm) — an on-demand "Generate via LLM"
 * affordance. Read-only/advisory: nothing is applied server-side (no fix-
 * activation flow yet). Tokens only.
 */

import React, { useState } from 'react';
import { LayoutGrid, ChevronRight, ChevronDown } from 'lucide-react';
import {
  useQueryPerfSuggestion,
  useLlmSuggest,
  type QueryPerfRowDto,
} from './query-perf-data';

const lab: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-muted)', margin: '16px 0 6px',
};

const codePre: React.CSSProperties = {
  background: 'var(--surface-inverse)', color: 'var(--text-inverse)', borderRadius: 8,
  padding: 12, fontSize: 11.5, lineHeight: 1.5, overflow: 'auto', margin: '6px 0',
};

/** Humanize a Referer route into a readable "Section › id" label. */
function sourceLabel(source: string | null): string {
  if (!source) return 'API / server';
  const parts = source.split('/').filter(Boolean);
  if (parts.length === 0) return 'App';
  const section = parts[0].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return parts.length > 1 ? `${section} › ${parts.slice(1).join('/')}` : section;
}

/** The verbatim query (admin-only) — collapsible since it can be long. */
function QueryBlock({ query }: { query: unknown }) {
  const [open, setOpen] = useState(false);
  if (query == null) return null;
  return (
    <>
      <div style={{ ...lab, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Query
        <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}>· verbatim (admin-only)</span>
      </div>
      {open && <pre style={codePre}>{JSON.stringify(query, null, 2)}</pre>}
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{
        fontSize: 12, fontWeight: 600, color: 'var(--text-on-brand)', background: 'var(--brand)',
        border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
      }}
    >
      {copied ? 'Copied ✓' : 'Copy YAML'}
    </button>
  );
}

export function QueryPerfOptimizePanel({ row }: { row: QueryPerfRowDto }) {
  const { suggestion, scaffold, loading, error } = useQueryPerfSuggestion(row.id);
  const llm = useLlmSuggest();

  return (
    <div
      style={{
        background: 'var(--surface-inset)', borderRadius: 8,
        padding: '14px 16px', fontFamily: 'var(--font-sans)',
      }}
      data-testid="qp-optimize-panel"
    >
      {/* Where the query came from (Referer-derived route) + HTTP method. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
        <LayoutGrid size={14} style={{ color: 'var(--text-muted)' }} />
        Used in <b style={{ color: 'var(--text-primary)' }}>{sourceLabel(row.source)}</b>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 6, padding: '1px 7px' }}>
          {row.method}
        </span>
      </div>

      {/* Verbatim query (admin-only), collapsible. */}
      <QueryBlock query={row.queryFull} />

      {loading && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Analyzing…</p>}
      {error && <p style={{ fontSize: 13, color: 'var(--destructive-ink)' }}>{error}</p>}

      {suggestion && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 8, padding: '9px 12px' }}>
            <b>{suggestion.verdict.matchability} · {suggestion.verdict.preaggHit}</b> — {suggestion.verdict.reason}
          </div>

          {suggestion.best && (
            <>
              <div style={lab}>Best remedy</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{suggestion.best.title}</div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 0' }}>{suggestion.best.rationale}</p>
              <ol style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 16, margin: '6px 0 0' }}>
                {suggestion.best.steps.map((s, i) => <li key={i} style={{ marginBottom: 2 }}>{s}</li>)}
              </ol>
            </>
          )}

          {scaffold && (
            <>
              <div style={lab}>Draft rollup</div>
              {scaffold.yaml ? (
                <>
                  <pre style={{ background: 'var(--surface-inverse)', color: 'var(--text-inverse)', borderRadius: 8, padding: 12, fontSize: 11.5, overflow: 'auto', margin: '6px 0' }}>{scaffold.yaml}</pre>
                  <CopyButton text={scaffold.yaml} />
                </>
              ) : null}
              {scaffold.warnings.length > 0 && (
                <ul style={{ fontSize: 11, color: 'var(--warning-ink)', background: 'var(--warning-soft)', borderRadius: 8, padding: '8px 10px 8px 24px', margin: '8px 0 0' }}>
                  {scaffold.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </>
          )}

          {suggestion.playbooks.length > 1 && (
            <>
              <div style={lab}>Alternatives</div>
              <ul style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 16, margin: 0 }}>
                {suggestion.playbooks.filter((p) => p.id !== suggestion.best?.id).map((p) => (
                  <li key={p.id} style={{ marginBottom: 2 }}>{p.title}</li>
                ))}
              </ul>
            </>
          )}

          {suggestion.needsLlm && (
            <>
              <div style={lab}>No playbook fits</div>
              {!llm.result && (
                <button
                  onClick={() => llm.generate(row.id)}
                  disabled={llm.loading}
                  style={{
                    fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', background: 'var(--bg-card)',
                    border: '1px solid var(--border-strong)', borderRadius: 8, padding: '7px 14px', cursor: 'pointer',
                  }}
                >
                  {llm.loading ? 'Generating…' : 'Generate via LLM'}
                </button>
              )}
              {llm.result?.suggestion && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8, whiteSpace: 'pre-wrap' }}>
                  {llm.result.suggestion}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                    via {llm.result.lane} · <button onClick={() => { llm.reset(); llm.generate(row.id); }} style={{ background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', padding: 0, fontSize: 11 }}>regenerate</button>
                  </div>
                </div>
              )}
              {llm.result?.error && (
                <p style={{ fontSize: 12, color: 'var(--warning-ink)', marginTop: 8 }}>LLM unavailable ({llm.result.error}) — try later.</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
