/**
 * Right-side drawer listing every finding for one cube×game cell: dev value vs
 * oracle value, file:line, dimension/severity, verdict, and a "View diff" link
 * that switches to the Diffs tab pre-loaded with this cube. Pure presentational;
 * the parent owns selection + the diff-navigation callback.
 */

import React from 'react';
import { X, ArrowRight } from 'lucide-react';
import type { ParityFinding } from './model-audit-types';
import { SEVERITY_TOKENS } from './model-audit-format';

export interface DrawerSelection {
  game: string;
  cube: string;
  hasProd: boolean;
  findings: ParityFinding[];
}

function SeverityChip({ severity }: { severity: string }) {
  const t = SEVERITY_TOKENS[severity] ?? { soft: 'var(--muted-soft)', ink: 'var(--muted-ink)', label: severity };
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        color: t.ink,
        background: t.soft,
        borderRadius: 'var(--radius-full)',
        padding: '2px 8px',
      }}
    >
      {t.label}
    </span>
  );
}

function FindingCard({ f }: { f: ParityFinding }) {
  return (
    <div
      style={{
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-card)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <SeverityChip severity={f.severity} />
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{f.dimension}</span>
        {f.verdict && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>verdict: {f.verdict}</span>
        )}
      </div>
      {f.detail && <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{f.detail}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
        <Field label="Dev" value={f.devValue} ink="var(--text-secondary)" />
        <Field label="Oracle" value={f.oracleValue} ink="var(--text-secondary)" />
      </div>
      {f.file && (
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {f.file}
          {f.line != null ? `:${f.line}` : ''}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, ink }: { label: string; value: string | null; ink: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div style={{ color: ink, fontFamily: 'var(--font-mono)', fontSize: 11.5, wordBreak: 'break-word' }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

export function FindingDetailDrawer({
  selection,
  onClose,
  onViewDiff,
}: {
  selection: DrawerSelection | null;
  onClose: () => void;
  onViewDiff: (game: string, cube: string) => void;
}) {
  if (!selection) return null;
  const { game, cube, hasProd, findings } = selection;
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.28)', zIndex: 40 }}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label={`${cube} · ${game}`}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(520px, 92vw)',
          background: 'var(--bg-card)',
          borderLeft: '1px solid var(--border-strong)',
          boxShadow: 'var(--shadow-lg, var(--shadow-sm))',
          zIndex: 41,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-card)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{cube}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {game}
              {!hasProd && ' · no oracle counterpart'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {findings.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--success-ink)' }}>No open findings — this cube is clean for {game}.</div>
          ) : (
            findings.map((f) => <FindingCard key={f.id} f={f} />)
          )}
          <button
            type="button"
            onClick={() => onViewDiff(game, cube)}
            style={{
              alignSelf: 'flex-start',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--brand)',
              color: 'var(--text-on-brand)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '7px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            View dev↔prod diff <ArrowRight size={15} />
          </button>
        </div>
      </aside>
    </>
  );
}
