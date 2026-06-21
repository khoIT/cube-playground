/**
 * Shared diff viewer: a structured field-change list above a line-oriented
 * unified text diff. Used by both Diffs-tab modes (dev↔prod and version↔version).
 * The text diff scrolls inside its own overflow container so the page body never
 * scrolls horizontally (design rule). All color via semantic tokens.
 */

import React from 'react';
import type { StructuredDiff, TextDiff, FieldChange } from './model-audit-types';

const KIND_STYLE: Record<FieldChange['kind'], { soft: string; ink: string; glyph: string }> = {
  added: { soft: 'var(--success-soft)', ink: 'var(--success-ink)', glyph: '+' },
  removed: { soft: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', glyph: '−' },
  changed: { soft: 'var(--warning-soft)', ink: 'var(--warning-ink)', glyph: '~' },
};

function ChangeRow({ c }: { c: FieldChange }) {
  const s = KIND_STYLE[c.kind];
  const label = c.name ? `${c.field}: ${c.name}` : c.field;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '4px 0', fontSize: 12.5 }}>
      <span
        style={{
          flexShrink: 0,
          width: 60,
          textAlign: 'center',
          fontWeight: 700,
          fontSize: 10.5,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          color: s.ink,
          background: s.soft,
          borderRadius: 'var(--radius-full)',
          padding: '2px 6px',
        }}
      >
        {c.kind}
      </span>
      <span style={{ fontWeight: 600, color: 'var(--text-primary)', minWidth: 0 }}>{label}</span>
      <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        {c.before != null && <span style={{ textDecoration: 'line-through', opacity: 0.8 }}>{c.before}</span>}
        {c.before != null && c.after != null && ' → '}
        {c.after != null && <span style={{ color: 'var(--text-secondary)' }}>{c.after}</span>}
      </span>
    </div>
  );
}

function StructuredDiffPanel({ structured }: { structured: StructuredDiff }) {
  if (!structured.devPresent || !structured.prodPresent) {
    return (
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '8px 0' }}>
        {structured.devPresent ? 'Dev-only cube — no counterpart to compare.' : 'No dev side present.'}
      </div>
    );
  }
  if (structured.changes.length === 0) {
    return (
      <div style={{ fontSize: 12.5, color: 'var(--success-ink)', padding: '8px 0' }}>
        No structural differences (PK, sql_table, measures, joins, rollups all match).
      </div>
    );
  }
  return (
    <div>
      {structured.changes.map((c, i) => (
        <ChangeRow key={`${c.field}-${c.name ?? ''}-${i}`} c={c} />
      ))}
    </div>
  );
}

const LINE_BG: Record<TextDiff['lines'][number]['kind'], string> = {
  add: 'var(--success-soft)',
  del: 'var(--destructive-soft)',
  ctx: 'transparent',
};
const LINE_GLYPH: Record<TextDiff['lines'][number]['kind'], string> = { add: '+', del: '−', ctx: ' ' };

function TextDiffPanel({ text }: { text: TextDiff }) {
  return (
    <div
      style={{
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-md)',
        overflow: 'auto',
        maxHeight: 460,
        background: 'var(--bg-card)',
      }}
    >
      <pre
        style={{
          margin: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: 1.5,
          minWidth: 'max-content',
        }}
      >
        {text.lines.map((l, i) => (
          <div key={i} style={{ background: LINE_BG[l.kind], padding: '0 12px', whiteSpace: 'pre' }}>
            <span style={{ color: 'var(--text-muted)', userSelect: 'none' }}>{LINE_GLYPH[l.kind]} </span>
            <span style={{ color: l.kind === 'ctx' ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
              {l.text || ' '}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}

export function DiffViewer({
  structured,
  text,
  beforeLabel,
  afterLabel,
}: {
  structured: StructuredDiff;
  text: TextDiff;
  beforeLabel: string;
  afterLabel: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={sectionLabel}>Structured changes</div>
        <StructuredDiffPanel structured={structured} />
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <div style={sectionLabel}>Text diff</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--destructive-ink)' }}>− {beforeLabel}</span>
            {'  '}
            <span style={{ color: 'var(--success-ink)' }}>+ {afterLabel}</span>
            {'   '}
            <span>
              +{text.added} −{text.removed}
            </span>
          </div>
        </div>
        <TextDiffPanel text={text} />
      </div>
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  marginBottom: 8,
};
