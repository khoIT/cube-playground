/**
 * Inline forms for the CS recommended-action rail.
 *
 * Extracted from cs-recommended-action-rail.tsx to keep each file under the
 * 200-line modularisation threshold.
 *
 * Three forms:
 *  - TreatForm   — channel + action-taken + optional note → triggers treatment PATCH.
 *  - DismissForm — reason picker → triggers dismiss PATCH.
 *
 * All forms are presentational: they call parent-owned async callbacks and surface
 * inline errors on rejection. Network and refetch logic stays in the parent view.
 *
 * Tokens only (var(--*)). No raw hex.
 */

import { useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import type { CareChannel } from './cs-member360-mock';
import { CHANNEL_LABEL } from './cs-member360-mock';
import { DISMISS_REASONS } from '../cs-case-actions';
import type { DismissReasonCode } from '../cs-case-actions';

// ── Shared styles ─────────────────────────────────────────────────────────────

export const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '7px 10px',
  fontSize: 12.5,
  fontFamily: 'var(--font-sans)',
  color: 'var(--text-primary)',
  background: 'var(--bg-app)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-md)',
  outline: 'none',
};

const ALL_CHANNELS: CareChannel[] = ['call', 'zalo_zns', 'in_game', 'email'];

// ── TreatForm ─────────────────────────────────────────────────────────────────

export interface TreatmentPayload {
  channel_used: CareChannel;
  action_taken: string;
  notes?: string;
}

interface TreatFormProps {
  onSubmit: (payload: TreatmentPayload) => Promise<void>;
  onCancel: () => void;
}

export function TreatForm({ onSubmit, onCancel }: TreatFormProps) {
  const [channel, setChannel] = useState<CareChannel>('call');
  const [actionTaken, setActionTaken] = useState('');
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = actionTaken.trim().length > 0 && !pending;

  async function handleSubmit() {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit({ channel_used: channel, action_taken: actionTaken.trim(), notes: notes.trim() || undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setPending(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>
          Channel used
        </label>
        <select value={channel} onChange={(e) => setChannel(e.target.value as CareChannel)} disabled={pending} style={INPUT_STYLE}>
          {ALL_CHANNELS.map((ch) => <option key={ch} value={ch}>{CHANNEL_LABEL[ch]}</option>)}
        </select>
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>
          Action taken <span style={{ color: 'var(--destructive-ink)' }}>*</span>
        </label>
        <input type="text" value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} disabled={pending} placeholder="Action taken (required)" style={INPUT_STYLE} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>
          Note (optional)
        </label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={pending} placeholder="Note (optional)" rows={2} style={{ ...INPUT_STYLE, resize: 'vertical' }} />
      </div>
      {error && <div style={{ fontSize: 11.5, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)', padding: '6px 10px', borderRadius: 'var(--radius-md)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={handleSubmit} disabled={!canSubmit} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)', padding: '10px 14px', borderRadius: 'var(--radius-md)', color: 'var(--text-on-brand)', background: canSubmit ? 'var(--brand)' : 'var(--border-strong)', border: 0, cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.7 }}>
          {pending ? 'Logging…' : 'Log treatment'} {!pending && <ArrowRight size={14} />}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} title="Cancel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--bg-muted)', border: '1px solid var(--border-card)', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

// ── DismissForm ───────────────────────────────────────────────────────────────

interface DismissFormProps {
  onConfirm: (reasonCode: DismissReasonCode) => Promise<void>;
  onCancel: () => void;
}

export function DismissForm({ onConfirm, onCancel }: DismissFormProps) {
  const [reason, setReason] = useState<DismissReasonCode>('false_positive');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm(reason);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setPending(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>
          Dismiss reason
        </label>
        <select value={reason} onChange={(e) => setReason(e.target.value as DismissReasonCode)} disabled={pending} style={INPUT_STYLE}>
          {(Object.entries(DISMISS_REASONS) as [DismissReasonCode, string][]).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </select>
      </div>
      {error && <div style={{ fontSize: 11.5, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)', padding: '6px 10px', borderRadius: 'var(--radius-md)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={handleConfirm} disabled={pending} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)', padding: '10px 14px', borderRadius: 'var(--radius-md)', color: 'var(--destructive-ink)', background: 'var(--destructive-soft)', border: '1px solid var(--destructive-ink)', cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.7 : 1 }}>
          {pending ? 'Dismissing…' : 'Confirm dismiss'}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} title="Cancel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--bg-muted)', border: '1px solid var(--border-card)', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
