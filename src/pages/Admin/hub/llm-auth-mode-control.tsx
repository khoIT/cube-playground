/**
 * LlmAuthModeControl — admin toggle for the chat agent's credential lane.
 *
 *   GET /api/admin/llm-auth → current mode + key-ladder status
 *   PUT /api/admin/llm-auth → switch 'auto' | 'gateway' | 'subscription'
 *
 * 'auto' = full failover ladder (gateway keys → subscription last resort);
 * 'gateway'/'subscription' pin the lane. Switching takes effect on the next
 * turn — no restart. chat-down degrades to a muted note. tokens.css only.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../api/api-client';

type LlmAuthMode = 'auto' | 'gateway' | 'subscription';

interface LlmAuthStatus {
  mode: LlmAuthMode;
  keys: { mode: LlmAuthMode; active: string; configured: string[]; exhausted: string[] };
}

interface LlmAuthResponse {
  generatedAt: number;
  status: LlmAuthStatus | null;
}

const MODES: Array<{ key: LlmAuthMode; label: string; hint: string }> = [
  { key: 'auto', label: 'Auto', hint: 'gateway keys first, subscription as last resort' },
  { key: 'gateway', label: 'Gateway keys', hint: 'never use the subscription quota' },
  { key: 'subscription', label: 'Subscription', hint: 'Claude subscription OAuth only' },
];

const card: React.CSSProperties = {
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-card)',
};

export function LlmAuthModeControl() {
  const [status, setStatus] = useState<LlmAuthStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refetch = useCallback(() => {
    apiFetch<LlmAuthResponse>('/api/admin/llm-auth')
      .then((r) => setStatus(r.status))
      .catch(() => setStatus(null))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  async function switchMode(mode: LlmAuthMode) {
    if (busy || mode === status?.mode) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch<LlmAuthResponse>('/api/admin/llm-auth', {
        method: 'PUT',
        body: { mode }, // apiFetch JSON-stringifies and sets Content-Type
      });
      setStatus(r.status);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const activeHint = MODES.find((m) => m.key === status?.mode)?.hint;

  return (
    <section style={{ ...card, marginTop: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border-card)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>LLM auth</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          credential lane for chat turns · applies on the next turn
        </span>
        {status && (
          <span
            style={{
              marginLeft: 'auto', fontSize: 11.5, fontWeight: 600,
              padding: '2px 8px', borderRadius: 'var(--radius-full)',
              background: 'var(--success-soft)', color: 'var(--success-ink)',
            }}
            title={`Configured: ${status.keys.configured.join(', ') || '—'}${status.keys.exhausted.length ? ` · exhausted: ${status.keys.exhausted.join(', ')}` : ''}`}
          >
            active key: {status.keys.active}
          </span>
        )}
      </div>

      {!loaded ? (
        <div style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
      ) : !status ? (
        <div style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>
          — chat-service unreachable, auth mode unavailable.
        </div>
      ) : (
        <div style={{ padding: '12px 14px' }}>
          <div role="radiogroup" aria-label="LLM auth mode" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {MODES.map((m) => {
              const active = m.key === status.mode;
              return (
                <button
                  key={m.key}
                  role="radio"
                  aria-checked={active}
                  type="button"
                  disabled={busy}
                  onClick={() => switchMode(m.key)}
                  title={m.hint}
                  style={{
                    fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
                    padding: '4px 10px', borderRadius: 'var(--radius-full)',
                    cursor: busy || active ? 'default' : 'pointer',
                    border: '1px solid var(--border-card)',
                    background: active ? 'var(--brand)' : 'var(--bg-card)',
                    color: active ? 'var(--text-on-brand)' : 'var(--text-secondary)',
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          {activeHint && (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8 }}>{activeHint}</div>
          )}
          {status.keys.exhausted.length > 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--warning-ink)', background: 'var(--warning-soft)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', marginTop: 8 }}>
              Cooling down after balance exhaustion: {status.keys.exhausted.join(', ')}
            </div>
          )}
          {err && (
            <div style={{ fontSize: 11.5, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', marginTop: 8 }}>
              {err}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
