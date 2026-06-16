/**
 * Master-detail Optimize panel — opens when an admin selects a failure row.
 *
 * Shows the classifier verdict, the best optimization playbook (+ alternatives),
 * the DRAFT rollup YAML when the remedy scaffolds one (copy-able, with warnings),
 * and — only when no playbook fits (needsLlm) — an on-demand "Generate via LLM"
 * affordance. Read-only/advisory: nothing is applied server-side. Tokens only.
 */

import React, { useState } from 'react';
import { X } from 'lucide-react';
import {
  useQueryPerfSuggestion,
  useLlmSuggest,
  type QueryPerfRowDto,
} from './query-perf-data';

const lab: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-muted)', margin: '16px 0 6px',
};

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

export function QueryPerfOptimizePanel({ row, onClose }: { row: QueryPerfRowDto; onClose: () => void }) {
  const { suggestion, scaffold, loading, error } = useQueryPerfSuggestion(row.id);
  const llm = useLlmSuggest();

  const shapeTitle = row.shape
    ? [row.shape.cubes[0], ...row.shape.measures, ...row.shape.dimensions]
        .filter(Boolean)
        .map((m) => (m?.includes('.') ? m.slice(m.indexOf('.') + 1) : m))
        .join(' · ')
    : `query #${row.id}`;

  return (
    <div
      style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 10,
        padding: '16px 18px', position: 'sticky', top: 16, fontFamily: 'var(--font-sans)',
      }}
      data-testid="qp-optimize-panel"
    >
      <div style={{ display: 'flex', alignItems: 'start', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, color: 'var(--text-primary)', flex: 1, wordBreak: 'break-word' }}>{shapeTitle}</h3>
        <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
          <X size={16} />
        </button>
      </div>

      {loading && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Analyzing…</p>}
      {error && <p style={{ fontSize: 13, color: 'var(--destructive-ink)' }}>{error}</p>}

      {suggestion && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 0', background: 'var(--surface-inset)', borderRadius: 8, padding: '9px 12px' }}>
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
