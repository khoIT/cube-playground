/**
 * ModelAuditShell — top-level page for /model-audit/*. Page-header pattern
 * (icon + 20/700 title), a shared control bar (run picker · severity counts ·
 * "Run audit now"), the tab bar, and a <Switch> rendering the active tab.
 *
 * The selected run lives in ModelAuditProvider so all tabs read one run.
 */

import React from 'react';
import { Switch, Route, Redirect } from 'react-router-dom';
import { ShieldCheck, Play, Loader2 } from 'lucide-react';
import { ModelAuditProvider, useModelAuditContext } from './model-audit-context';
import { ModelAuditTabs } from './model-audit-tabs';
import { useParityRuns, useRunAudit } from './use-model-audit-api';
import { SEVERITY_TOKENS, relativeTime } from './model-audit-format';
import { FindingsTab } from './findings-tab';
import { DiffsTab } from './diffs-tab';
import { UpstreamTab } from './upstream-tab';
import { TrendTab } from './trend-tab';
import type { ParityRun } from './model-audit-types';

const pageStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1400,
  margin: '0 auto',
  fontFamily: 'var(--font-sans)',
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  marginBottom: 6,
};

function CountBadge({ severity, n }: { severity: string; n: number }) {
  const t = SEVERITY_TOKENS[severity];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        fontWeight: 600,
        color: t.ink,
        background: t.soft,
        borderRadius: 'var(--radius-full)',
        padding: '3px 10px',
      }}
    >
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{n}</span> {t.label.toLowerCase()}
    </span>
  );
}

function ControlBar() {
  const { selectedRunId, setSelectedRunId } = useModelAuditContext();
  const { data, refetch } = useParityRuns();
  const runAudit = useRunAudit();
  const runs: ParityRun[] = data?.runs ?? [];
  const resolved = selectedRunId === 'latest' ? runs[0] : runs.find((r) => r.id === selectedRunId);

  const onRun = async () => {
    const res = await runAudit.run();
    if (res) {
      refetch();
      setSelectedRunId('latest');
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        margin: '4px 0 16px',
      }}
    >
      <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Run{' '}
        <select
          value={String(selectedRunId)}
          onChange={(e) => setSelectedRunId(e.target.value === 'latest' ? 'latest' : Number(e.target.value))}
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            padding: '4px 8px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-card)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
          }}
        >
          <option value="latest">Latest</option>
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              #{r.id} · {relativeTime(r.startedAt)} {r.status === 'error' ? '(error)' : ''}
            </option>
          ))}
        </select>
      </label>

      {resolved && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <CountBadge severity="correctness" n={resolved.countCorrectness} />
          <CountBadge severity="parity" n={resolved.countParity} />
          <CountBadge severity="cosmetic" n={resolved.countCosmetic} />
        </div>
      )}

      <button
        type="button"
        onClick={onRun}
        disabled={runAudit.isLoading}
        style={{
          marginLeft: 'auto',
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
          cursor: runAudit.isLoading ? 'wait' : 'pointer',
          opacity: runAudit.isLoading ? 0.7 : 1,
        }}
      >
        {runAudit.isLoading ? <Loader2 size={15} /> : <Play size={15} />}
        {runAudit.isLoading ? 'Running…' : 'Run audit now'}
      </button>
      {runAudit.error && <span style={{ fontSize: 12, color: 'var(--destructive-ink)' }}>{runAudit.error}</span>}
    </div>
  );
}

export function ModelAuditShell() {
  return (
    <ModelAuditProvider>
      <div style={pageStyle}>
        <div style={eyebrowStyle}>Cube model · cross-game parity</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShieldCheck size={20} style={{ color: 'var(--brand)' }} />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Model Audit</h1>
        </div>
        <p style={{ margin: '4px 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>
          Correctness + parity findings across every per-game Cube model, diffed against the validated prod clone.
        </p>

        <ControlBar />
        <ModelAuditTabs />

        <div style={{ marginTop: 20 }}>
          <Switch>
            <Route exact path="/model-audit">
              <Redirect to="/model-audit/findings" />
            </Route>
            <Route path="/model-audit/findings">
              <FindingsTab />
            </Route>
            <Route path="/model-audit/diffs">
              <DiffsTab />
            </Route>
            <Route path="/model-audit/upstream">
              <UpstreamTab />
            </Route>
            <Route path="/model-audit/trend">
              <TrendTab />
            </Route>
          </Switch>
        </div>
      </div>
    </ModelAuditProvider>
  );
}
