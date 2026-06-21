/**
 * Upstream tab — prod-clone status card: local sha vs kraken/cube upstream HEAD,
 * behind/ahead, last fetch. "Refresh from kraken/cube" runs an ff-only git pull
 * server-side and reports the result + files changed. Read-only otherwise.
 */

import React, { useState } from 'react';
import { GitBranch, RefreshCw, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useProdStatus, useRefreshProd } from './use-model-audit-api';
import { relativeTime, shortSha } from './model-audit-format';
import type { RefreshResult } from './model-audit-types';

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-primary)', fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)' }}>
        {value}
      </div>
    </div>
  );
}

export function UpstreamTab() {
  const status = useProdStatus();
  const refresh = useRefreshProd();
  const [result, setResult] = useState<RefreshResult | null>(null);

  const onRefresh = async () => {
    const r = await refresh.run();
    if (r) {
      setResult(r);
      status.refetch();
    }
  };

  if (status.isLoading) return <div style={muted}>Checking clone…</div>;
  if (status.error) return <div style={errorStyle}>{status.error}</div>;
  const s = status.data;
  if (!s) return <div style={muted}>No status.</div>;

  if (!s.available) {
    return (
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--destructive-ink)' }}>
          <AlertTriangle size={16} /> Prod clone unavailable
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6 }}>
          {s.error} — expected a git checkout at <code style={{ fontFamily: 'var(--font-mono)' }}>{s.root}</code>.
        </div>
      </div>
    );
  }

  const behind = s.behind ?? 0;
  const isBehind = behind > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <GitBranch size={16} style={{ color: 'var(--brand)' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>kraken/cube clone</span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              fontWeight: 600,
              color: isBehind ? 'var(--warning-ink)' : 'var(--success-ink)',
              background: isBehind ? 'var(--warning-soft)' : 'var(--success-soft)',
              borderRadius: 'var(--radius-full)',
              padding: '3px 10px',
            }}
          >
            {isBehind ? `${behind} behind upstream` : 'up to date'}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
          <Stat label="Branch" value={s.branch ?? '—'} mono />
          <Stat label="Local HEAD" value={shortSha(s.localSha)} mono />
          <Stat label="Upstream HEAD" value={shortSha(s.upstreamSha)} mono />
          <Stat label="Behind / ahead" value={`${s.behind ?? '—'} / ${s.ahead ?? '—'}`} />
          <Stat label="Last fetch" value={relativeTime(s.lastFetchAt)} />
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={refresh.isLoading}
          style={{
            marginTop: 16,
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
            cursor: refresh.isLoading ? 'wait' : 'pointer',
            opacity: refresh.isLoading ? 0.7 : 1,
          }}
        >
          {refresh.isLoading ? <Loader2 size={15} /> : <RefreshCw size={15} />}
          {refresh.isLoading ? 'Refreshing…' : 'Refresh from kraken/cube'}
        </button>
        {refresh.error && <div style={{ fontSize: 12, color: 'var(--destructive-ink)', marginTop: 8 }}>{refresh.error}</div>}
      </div>

      {result && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: result.ok ? 'var(--success-ink)' : 'var(--destructive-ink)' }}>
            {result.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span style={{ fontSize: 13, fontWeight: 600 }}>{result.message}</span>
          </div>
          {result.changedFiles.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', marginBottom: 6 }}>
                {result.changedFiles.length} file(s) changed
              </div>
              <div style={{ maxHeight: 240, overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-secondary)' }}>
                {result.changedFiles.map((f) => (
                  <div key={f}>{f}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
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
const muted: React.CSSProperties = { fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' };
const errorStyle: React.CSSProperties = { fontSize: 13, color: 'var(--destructive-ink)', padding: '16px 0' };
