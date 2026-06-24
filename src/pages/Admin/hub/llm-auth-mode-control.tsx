/**
 * LlmAuthModeControl — admin toggle for the chat agent's credential KEY and the
 * global MODEL, applied to all users.
 *
 *   GET /api/admin/llm-auth          → current mode + key ladder + model status
 *   PUT /api/admin/llm-auth { mode }  → switch key/lane (auto | gateway | a
 *                                       specific subscription token)
 *   PUT /api/admin/llm-auth { model } → set/clear the global model override
 *
 * 'auto' = full failover ladder (gateway keys → subscription last resort);
 * 'gateway' pins the gateway lane; a subscription-* mode pins one OAuth token.
 * The model dropdown forces every turn to one model ("Server default" clears
 * it). Both apply on the next turn — no restart. chat-down degrades to a muted
 * note. tokens.css only.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../api/api-client';

type LlmAuthMode = 'auto' | 'gateway' | 'subscription' | 'subscription-vy' | 'subscription-thi';

interface LlmAuthStatus {
  mode: LlmAuthMode;
  keys: { mode: LlmAuthMode; active: string; configured: string[]; exhausted: string[] };
  modelOverride: string | null;
  allowedModels: string[];
  defaultModel: string;
}

interface LlmAuthResponse {
  generatedAt: number;
  status: LlmAuthStatus | null;
}

/** Human label + hint per selectable key/lane. */
const KEY_META: Record<LlmAuthMode, { label: string; hint: string }> = {
  auto: { label: 'Auto', hint: 'gateway keys first, subscription as last resort' },
  gateway: { label: 'Gateway keys', hint: 'never use the subscription quota' },
  subscription: { label: 'Subscription', hint: 'pin the primary Claude subscription token' },
  'subscription-vy': { label: 'Sub · VY', hint: 'pin the VY subscription token' },
  'subscription-thi': { label: 'Sub · THI', hint: 'pin the THI subscription token' },
};

/** Gateway labels — presence means the "Gateway keys" lane is selectable. */
const GATEWAY_LABELS = ['primary', 'stg', 'backup'];

/** Build the ordered list of selectable key modes from the configured slots. */
function keyOptions(configured: string[]): LlmAuthMode[] {
  const opts: LlmAuthMode[] = ['auto'];
  if (configured.some((l) => GATEWAY_LABELS.includes(l))) opts.push('gateway');
  for (const label of ['subscription', 'subscription-vy', 'subscription-thi'] as const) {
    if (configured.includes(label)) opts.push(label);
  }
  return opts;
}

const card: React.CSSProperties = {
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-card)',
};

const sectionLabel: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
};

export function LlmAuthModeControl() {
  const [status, setStatus] = useState<LlmAuthStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Secondary block on the org overview — collapsed by default so the page
  // leads with triage (KPIs / pending / inactive), not credential controls.
  const [open, setOpen] = useState(false);

  const refetch = useCallback(() => {
    apiFetch<LlmAuthResponse>('/api/admin/llm-auth')
      .then((r) => setStatus(r.status))
      .catch(() => setStatus(null))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  /** Apply a partial change ({mode} or {model}) and refresh from the response. */
  async function apply(body: { mode: LlmAuthMode } | { model: string | null }) {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch<LlmAuthResponse>('/api/admin/llm-auth', { method: 'PUT', body });
      setStatus(r.status);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const activeHint = status ? KEY_META[status.mode]?.hint : undefined;

  return (
    <section style={{ ...card, marginTop: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: open ? '1px solid var(--border-card)' : 'none', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Toggle LLM key & model"
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11, padding: 0, width: 12, flexShrink: 0, fontFamily: 'var(--font-sans)' }}
        >
          {open ? '▾' : '▸'}
        </button>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>LLM key &amp; model</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          credential + model for all chat turns · applies on the next turn
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

      {open && (!loaded ? (
        <div style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
      ) : !status ? (
        <div style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>
          — chat-service unreachable, controls unavailable.
        </div>
      ) : (
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Key / lane selector */}
          <div>
            <div style={sectionLabel}>Credential key</div>
            <div role="radiogroup" aria-label="LLM credential key" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
              {keyOptions(status.keys.configured).map((key) => {
                const active = key === status.mode;
                return (
                  <button
                    key={key}
                    role="radio"
                    aria-checked={active}
                    type="button"
                    disabled={busy}
                    onClick={() => { if (!active) apply({ mode: key }); }}
                    title={KEY_META[key].hint}
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
                    {KEY_META[key].label}
                  </button>
                );
              })}
            </div>
            {activeHint && (
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8 }}>{activeHint}</div>
            )}
          </div>

          {/* Global model override */}
          <div>
            <div style={sectionLabel}>Model (all users)</div>
            <select
              aria-label="Global chat model"
              disabled={busy}
              value={status.modelOverride ?? ''}
              onChange={(e) => apply({ model: e.target.value || null })}
              style={{
                marginTop: 6, height: 32, padding: '0 10px', maxWidth: 320,
                fontSize: 12.5, fontFamily: 'var(--font-sans)',
                background: 'var(--bg-input, var(--bg-muted))',
                border: '1px solid var(--border-card)', borderRadius: 'var(--radius-card)',
                color: 'var(--text-primary)', cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              <option value="">Server default ({status.defaultModel})</option>
              {status.allowedModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8 }}>
              Forces this model for every user. Non-Sonnet models run on the subscription
              lane — the gateway key serves Sonnet only.
            </div>
          </div>

          {status.keys.exhausted.length > 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--warning-ink)', background: 'var(--warning-soft)', borderRadius: 'var(--radius-sm)', padding: '6px 8px' }}>
              Cooling down after balance exhaustion: {status.keys.exhausted.join(', ')}
            </div>
          )}
          {err && (
            <div style={{ fontSize: 11.5, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)', borderRadius: 'var(--radius-sm)', padding: '6px 8px' }}>
              {err}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
