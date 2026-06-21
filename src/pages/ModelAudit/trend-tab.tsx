/**
 * Trend tab — findings-by-severity across the last K runs (stacked bars) plus a
 * newly-introduced vs cleared delta list between the selected run and its
 * predecessor. Bars are token-styled divs (no chart dependency); the delta keys
 * findings by game·cube·root-cause so a fix that clears across games is visible.
 */

import React, { useMemo } from 'react';
import { useModelAuditContext } from './model-audit-context';
import { useParityRuns, useRunFindings } from './use-model-audit-api';
import { SEVERITY_TOKENS, relativeTime } from './model-audit-format';
import type { ParityFinding, ParityRun } from './model-audit-types';

const MAX_RUNS = 12;

function findingKey(f: ParityFinding): string {
  return `${f.game}::${f.cube}::${f.rootCauseKey}`;
}

function StackedBar({ run, max }: { run: ParityRun; max: number }) {
  const total = run.countCorrectness + run.countParity + run.countCosmetic;
  const h = (n: number) => (max > 0 ? Math.round((n / max) * 120) : 0);
  const seg = (sev: string, n: number) =>
    n > 0 ? <div key={sev} style={{ height: h(n), background: SEVERITY_TOKENS[sev].ink, opacity: 0.85 }} /> : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 36 }} title={`run #${run.id}: ${total} findings`}>
      <div style={{ display: 'flex', flexDirection: 'column-reverse', width: 22, height: 120, justifyContent: 'flex-start', borderRadius: 3, overflow: 'hidden', background: 'var(--bg-muted)' }}>
        {seg('cosmetic', run.countCosmetic)}
        {seg('parity', run.countParity)}
        {seg('correctness', run.countCorrectness)}
      </div>
      <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>#{run.id}</div>
    </div>
  );
}

function DeltaList({ title, findings, tone }: { title: string; findings: ParityFinding[]; tone: 'add' | 'clear' }) {
  const ink = tone === 'add' ? 'var(--destructive-ink)' : 'var(--success-ink)';
  return (
    <div style={{ flex: '1 1 280px', minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: ink, marginBottom: 8 }}>
        {tone === 'add' ? '▲' : '▼'} {title} ({findings.length})
      </div>
      {findings.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>None.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto' }}>
          {findings.map((f) => (
            <div key={f.id} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                {f.game}/{f.cube}
              </span>{' '}
              <span style={{ color: 'var(--text-muted)' }}>· {f.dimension} · {f.severity}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TrendTab() {
  const { selectedRunId } = useModelAuditContext();
  const { data: runsData } = useParityRuns();
  const runs = useMemo(() => (runsData?.runs ?? []).filter((r) => r.status === 'ok'), [runsData]);

  // Resolve the selected run and its predecessor (by recency) for the delta.
  const selected = selectedRunId === 'latest' ? runs[0] : runs.find((r) => r.id === selectedRunId);
  const selectedIdx = selected ? runs.findIndex((r) => r.id === selected.id) : -1;
  const prev = selectedIdx >= 0 ? runs[selectedIdx + 1] : undefined;

  const curFindings = useRunFindings(selected ? selected.id : null);
  const prevFindings = useRunFindings(prev ? prev.id : null);

  const { introduced, cleared } = useMemo(() => {
    const cur = curFindings.data?.findings ?? [];
    const old = prevFindings.data?.findings ?? [];
    if (!prev) return { introduced: cur, cleared: [] as ParityFinding[] };
    const oldKeys = new Set(old.map(findingKey));
    const curKeys = new Set(cur.map(findingKey));
    return {
      introduced: cur.filter((f) => !oldKeys.has(findingKey(f))),
      cleared: old.filter((f) => !curKeys.has(findingKey(f))),
    };
  }, [curFindings.data, prevFindings.data, prev]);

  if (!runs.length) return <div style={muted}>No recorded runs yet.</div>;

  // Oldest→newest for the bar series (chronological left-to-right).
  const series = [...runs.slice(0, MAX_RUNS)].reverse();
  const max = Math.max(1, ...series.map((r) => r.countCorrectness + r.countParity + r.countCosmetic));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1000 }}>
      <div style={card}>
        <div style={sectionLabel}>Findings by severity · last {series.length} runs</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, overflowX: 'auto', paddingTop: 8 }}>
          {series.map((r) => (
            <StackedBar key={r.id} run={r} max={max} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 12 }}>
          {(['correctness', 'parity', 'cosmetic'] as const).map((sev) => (
            <span key={sev} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: SEVERITY_TOKENS[sev].ink }} />
              {SEVERITY_TOKENS[sev].label}
            </span>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={sectionLabel}>
          Change since previous run{prev ? ` (#${prev.id} → #${selected?.id})` : ' (first run)'}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 12 }}>
          {selected ? `#${selected.id} · ${relativeTime(selected.startedAt)}` : ''}
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <DeltaList title="Newly introduced" findings={introduced} tone="add" />
          <DeltaList title="Cleared" findings={cleared} tone="clear" />
        </div>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  padding: '18px 20px',
  boxShadow: 'var(--shadow-sm)',
};
const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  marginBottom: 8,
};
const muted: React.CSSProperties = { fontSize: 13, color: 'var(--text-muted)', padding: '24px 0' };
