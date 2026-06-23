/**
 * AlertRulesTab — lists a game's alert rules and provides an inline rule builder.
 *
 * Rules are threshold/condition conditions that fire in-app notifications when a
 * Cube metric breaches (e.g. "DAU pct_drop ≥ 5 over 7 days"). Each rule is
 * owner-scoped; the server validates identity on every write.
 */

import React, { useState } from 'react';
import { BellRing, Trash2, ToggleLeft, ToggleRight, Plus, AlertCircle } from 'lucide-react';
import { useGameContext } from '../../../components/Header/use-game-context';
import { useAlertRules, type Comparator, type CreateRuleInput } from './use-alert-rules';

const COMPARATOR_LABELS: Record<Comparator, string> = {
  '<':        '< (below)',
  '>':        '> (above)',
  '<=':       '≤ (at or below)',
  '>=':       '≥ (at or above)',
  pct_drop:   '% drop ≥ threshold',
  pct_rise:   '% rise ≥ threshold',
};

const COMPARATORS = Object.keys(COMPARATOR_LABELS) as Comparator[];

// ── Styles (inline, design tokens only) ──────────────────────────────────────

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

const ruleRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 0',
  borderBottom: '1px solid var(--border-card)',
};

const ruleRowLast: React.CSSProperties = { ...ruleRow, borderBottom: 'none' };

const tag: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 6px',
  borderRadius: 4,
  background: 'var(--info-soft)',
  color: 'var(--info-ink)',
};

const formGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '10px 14px',
};

const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--text-secondary)',
  display: 'block',
  marginBottom: 4,
};

const input: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  border: '1px solid var(--border-card)',
  borderRadius: 6,
  background: 'var(--bg-app)',
  color: 'var(--text-primary)',
  boxSizing: 'border-box',
};

const select: React.CSSProperties = { ...input, cursor: 'pointer' };

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

// ── Component ─────────────────────────────────────────────────────────────────

interface FormState {
  metric: string;
  comparator: Comparator;
  threshold: string;
  window: string;
}

const DEFAULT_FORM: FormState = {
  metric: '',
  comparator: 'pct_drop',
  threshold: '5',
  window: '',
};

export function AlertRulesTab() {
  const { gameId } = useGameContext();
  const { rules, loading, error, createRule, toggleRule, deleteRule } = useAlertRules(gameId);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const thresholdNum = parseFloat(form.threshold);
    if (!form.metric.trim()) { setFormError('Metric is required'); return; }
    if (!Number.isFinite(thresholdNum)) { setFormError('Threshold must be a number'); return; }

    const input: CreateRuleInput = {
      game: gameId,
      metric: form.metric.trim(),
      comparator: form.comparator,
      threshold: thresholdNum,
      ...(form.window.trim() ? { window: form.window.trim() } : {}),
    };

    setSubmitting(true);
    setFormError(null);
    try {
      await createRule(input);
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
            Alert rules
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Threshold conditions that fire an in-app notification when a metric breaches.
            Each rule fires at most once per day to avoid spam.
          </div>
        </div>
        <button style={btnPrimary} onClick={() => { setShowForm((v) => !v); setFormError(null); }}>
          <Plus size={14} />
          New rule
        </button>
      </div>

      {/* ── Rule builder form ── */}
      {showForm && (
        <div style={card}>
          <div style={sectionTitle}>New alert rule — {gameId}</div>
          <form onSubmit={handleSubmit}>
            <div style={formGrid}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={label}>Metric (Cube measure, e.g. active_daily.dau)</label>
                <input
                  style={input}
                  value={form.metric}
                  onChange={(e) => setForm((f) => ({ ...f, metric: e.target.value }))}
                  placeholder="active_daily.dau"
                  autoFocus
                />
              </div>
              <div>
                <label style={label}>Comparator</label>
                <select
                  style={select}
                  value={form.comparator}
                  onChange={(e) => setForm((f) => ({ ...f, comparator: e.target.value as Comparator }))}
                >
                  {COMPARATORS.map((c) => (
                    <option key={c} value={c}>{COMPARATOR_LABELS[c]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={label}>
                  Threshold
                  {(form.comparator === 'pct_drop' || form.comparator === 'pct_rise') ? ' (%)' : ''}
                </label>
                <input
                  style={input}
                  type="number"
                  step="any"
                  value={form.threshold}
                  onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))}
                  placeholder="5"
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={label}>Window hint (optional, e.g. 7d, 24h)</label>
                <input
                  style={input}
                  value={form.window}
                  onChange={(e) => setForm((f) => ({ ...f, window: e.target.value }))}
                  placeholder="7d"
                />
              </div>
            </div>
            {formError && (
              <div style={{ ...errorMsg, marginTop: 10 }}>
                <AlertCircle size={13} />{formError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button type="submit" style={btnPrimary} disabled={submitting}>
                {submitting ? 'Saving…' : 'Save rule'}
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

      {/* ── Rule list ── */}
      <div>
        <div style={sectionTitle}>Rules for {gameId}</div>
        {error && (
          <div style={errorMsg}>
            <AlertCircle size={13} />Failed to load rules: {error}
          </div>
        )}
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        ) : rules.length === 0 ? (
          <div style={{ ...card, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            <BellRing size={20} style={{ marginBottom: 6, opacity: 0.4 }} />
            <div>No alert rules yet. Create one to get notified when a metric breaches.</div>
          </div>
        ) : (
          <div style={card}>
            {rules.map((rule, idx) => (
              <div key={rule.id} style={idx === rules.length - 1 ? ruleRowLast : ruleRow}>
                <BellRing size={14} style={{ color: rule.enabled ? 'var(--brand)' : 'var(--text-muted)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                    {rule.metric}
                    <span style={{ ...tag, marginLeft: 8 }}>{COMPARATOR_LABELS[rule.comparator as Comparator] ?? rule.comparator}</span>
                    <span style={{ marginLeft: 6, color: 'var(--text-secondary)' }}>
                      {rule.threshold}
                      {(rule.comparator === 'pct_drop' || rule.comparator === 'pct_rise') ? '%' : ''}
                    </span>
                  </div>
                  {rule.window && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                      window: {rule.window}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: rule.enabled ? 'var(--success-ink)' : 'var(--text-muted)' }}>
                  {rule.enabled ? 'enabled' : 'disabled'}
                </div>
                <button
                  style={btnGhost}
                  title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                  onClick={() => toggleRule(rule.id, !rule.enabled)}
                  aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                >
                  {rule.enabled ? <ToggleRight size={18} color="var(--brand)" /> : <ToggleLeft size={18} />}
                </button>
                <button
                  style={{ ...btnGhost, color: 'var(--destructive-ink)' }}
                  title="Delete rule"
                  onClick={() => deleteRule(rule.id)}
                  aria-label="Delete rule"
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
