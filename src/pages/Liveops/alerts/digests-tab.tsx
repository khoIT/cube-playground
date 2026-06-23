/**
 * DigestsTab — relocated from Catalog/digest and made real.
 *
 * Shows the owner's digest subscriptions for the active game (real DB rows from
 * migration 072), lets them create new subscriptions (game + metric list +
 * cadence), and previews what a digest would contain. Delivery is in-app only
 * (v1) — the driver seam is ready for Slack/email later.
 *
 * Subscription manager replaces the Catalog mock entirely. The Catalog route
 * (/catalog/digest) now redirects here so bookmarks keep working.
 */

import React, { useState } from 'react';
import { CalendarClock, Trash2, Plus, AlertCircle, Clock } from 'lucide-react';
import { useGameContext } from '../../../components/Header/use-game-context';
import { useDigestSubscriptions, type DigestCadence, type CreateSubscriptionInput } from './use-digest-subscriptions';

// ── Styles ────────────────────────────────────────────────────────────────────

const wrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  fontFamily: 'var(--font-sans)',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 8,
};

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-card)',
  borderRadius: 8,
  padding: '14px 16px',
};

const subRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '10px 0',
  borderBottom: '1px solid var(--border-card)',
};

const subRowLast: React.CSSProperties = { ...subRow, borderBottom: 'none' };

const badge: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 7px',
  borderRadius: 4,
  background: 'var(--info-soft)',
  color: 'var(--info-ink)',
  whiteSpace: 'nowrap' as const,
};

const formGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '10px 14px',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--text-secondary)',
  display: 'block',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  border: '1px solid var(--border-card)',
  borderRadius: 6,
  background: 'var(--bg-app)',
  color: 'var(--text-primary)',
  boxSizing: 'border-box' as const,
};

const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };

const btnPrimary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 14px',
  fontSize: 13,
  fontWeight: 500,
  border: 'none',
  borderRadius: 6,
  background: 'var(--brand)',
  color: 'var(--text-inverse)',
  cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  padding: 4,
  display: 'inline-flex',
  alignItems: 'center',
};

const errorMsg: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--destructive-ink)',
  background: 'var(--destructive-soft)',
  borderRadius: 6,
  padding: '6px 10px',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatNextRun(ms: number | null): string {
  if (ms == null) return 'not scheduled';
  const d = new Date(ms);
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

// ── Component ─────────────────────────────────────────────────────────────────

interface FormState {
  metrics: string;   // comma-separated metric ids
  cadence: DigestCadence;
}

const DEFAULT_FORM: FormState = { metrics: '', cadence: 'daily' };

export function DigestsTab() {
  const { gameId } = useGameContext();
  const { subscriptions, loading, error, createSubscription, deleteSubscription } =
    useDigestSubscriptions(gameId);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const metricIds = form.metrics
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    if (metricIds.length === 0) { setFormError('Enter at least one metric id'); return; }

    const input: CreateSubscriptionInput = {
      game: gameId,
      metrics: metricIds,
      cadence: form.cadence,
    };

    setSubmitting(true);
    setFormError(null);
    try {
      await createSubscription(input);
      setForm(DEFAULT_FORM);
      setShowForm(false);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={wrap}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
            Digests &amp; schedule
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Subscribe to scheduled in-app digests — KPIs, open anomalies, and top deltas
            delivered on a cadence. Delivered to your notification bell (in-app only, v1).
          </div>
        </div>
        <button style={btnPrimary} onClick={() => { setShowForm((v) => !v); setFormError(null); }}>
          <Plus size={14} />
          New subscription
        </button>
      </div>

      {/* ── Subscription builder ── */}
      {showForm && (
        <div style={card}>
          <div style={sectionTitle}>New digest subscription — {gameId}</div>
          <form onSubmit={handleSubmit}>
            <div style={formGrid}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>
                  Metrics (comma-separated Cube measure ids)
                </label>
                <input
                  style={inputStyle}
                  value={form.metrics}
                  onChange={(e) => setForm((f) => ({ ...f, metrics: e.target.value }))}
                  placeholder="active_daily.dau, user_recharge_daily.revenue_vnd_total"
                  autoFocus
                />
              </div>
              <div>
                <label style={labelStyle}>Cadence</label>
                <select
                  style={selectStyle}
                  value={form.cadence}
                  onChange={(e) => setForm((f) => ({ ...f, cadence: e.target.value as DigestCadence }))}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
            </div>
            {formError && (
              <div style={{ ...errorMsg, marginTop: 10 }}>
                <AlertCircle size={13} />{formError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="submit" style={btnPrimary} disabled={submitting}>
                {submitting ? 'Saving…' : 'Save subscription'}
              </button>
              <button
                type="button"
                style={{ ...btnPrimary, background: 'var(--bg-app)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}
                onClick={() => { setShowForm(false); setFormError(null); }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Subscription list ── */}
      <div>
        <div style={sectionTitle}>Subscriptions for {gameId}</div>
        {error && (
          <div style={errorMsg}>
            <AlertCircle size={13} />Failed to load subscriptions: {error}
          </div>
        )}
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        ) : subscriptions.length === 0 ? (
          <div style={{ ...card, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            <CalendarClock size={20} style={{ marginBottom: 6, opacity: 0.4 }} />
            <div>No subscriptions yet. Create one to receive scheduled metric digests.</div>
          </div>
        ) : (
          <div style={card}>
            {subscriptions.map((sub, idx) => (
              <div key={sub.id} style={idx === subscriptions.length - 1 ? subRowLast : subRow}>
                <CalendarClock size={14} style={{ color: 'var(--brand)', marginTop: 2, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                      {sub.cadence.charAt(0).toUpperCase() + sub.cadence.slice(1)} digest
                    </span>
                    <span style={badge}>{sub.cadence}</span>
                    <span style={{ ...badge, background: 'var(--muted-soft)', color: 'var(--muted-ink)' }}>
                      {sub.metrics.length} metric{sub.metrics.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sub.metrics.join(', ')}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                    <Clock size={10} />
                    Next: {formatNextRun(sub.next_run_at)}
                    {sub.last_run_date && (
                      <span style={{ marginLeft: 8 }}>· Last: {sub.last_run_date}</span>
                    )}
                  </div>
                </div>
                <button
                  style={{ ...btnGhost, color: 'var(--destructive-ink)' }}
                  title="Delete subscription"
                  onClick={() => deleteSubscription(sub.id)}
                  aria-label="Delete subscription"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
