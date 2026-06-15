/**
 * Recommended-next-action rail — the decision sidekick beside the care timeline.
 *
 * Surfaces the single most-urgent open match as a "do this next" card: why the
 * VIP surfaced, suggested outreach channels, a talk-track, a bundle to offer,
 * and the SLA.
 *
 * CTA set is driven by caseStatus:
 *   open (new/in_review) → "Mark treated" + optional "Dismiss"
 *   treated              → "Close · KPI met" / "Close · KPI missed"
 *   otherwise            → no CTA (case is already closed)
 *
 * All network calls are parent-owned — this component is presentational.
 * Inline forms live in cs-action-rail-forms.tsx to keep files under ~200 LOC.
 *
 * Tokens only; semantic status pairs for dark-mode safety.
 */

import { useState } from 'react';
import { Phone, MessageSquare, Gamepad2, Mail, Sparkles, Check, ArrowRight, X, Ban } from 'lucide-react';
import type { RecommendedAction, CarePriority, CareChannel } from './cs-member360-mock';
import { CHANNEL_LABEL } from './cs-member360-mock';
import type { DismissReasonCode, CloseOutcome } from '../cs-case-actions';
import { TreatForm, DismissForm } from './cs-action-rail-forms';
export type { TreatmentPayload } from './cs-action-rail-forms';

// ── Visual maps ───────────────────────────────────────────────────────────────

const PRIORITY_TINT: Record<CarePriority, { bg: string; ink: string; label: string }> = {
  cao: { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', label: 'Cao · urgent' },
  tb: { bg: 'var(--info-soft)', ink: 'var(--info-ink)', label: 'TB' },
  thap: { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)', label: 'Thấp' },
};

const CHANNEL_ICON: Record<CareChannel, React.ReactNode> = {
  call: <Phone size={14} />,
  zalo_zns: <MessageSquare size={14} />,
  in_game: <Gamepad2 size={14} />,
  email: <Mail size={14} />,
};

// ── Sub-components ────────────────────────────────────────────────────────────

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{children}</div>
    </div>
  );
}

// ── Rail props ────────────────────────────────────────────────────────────────

interface RailProps {
  action: RecommendedAction;
  /**
   * Current status of the underlying case — drives which CTA set is shown.
   * 'treated'        → close-with-outcome buttons (KPI met / KPI missed).
   * 'new'/'in_review'→ treat CTA + optional dismiss.
   * absent/other     → no CTA (case already resolved/dismissed).
   */
  caseStatus?: string;
  canWrite: boolean;
  /** Promise-returning callback; parent owns PATCH + refetch. */
  onSubmitTreatment: (payload: import('./cs-action-rail-forms').TreatmentPayload) => Promise<void>;
  /**
   * When provided, a secondary "Dismiss" button appears below the treat CTA.
   * Parent wires this to dismissCase + refetch.
   */
  onDismiss?: (reasonCode: DismissReasonCode) => Promise<void>;
  /**
   * When provided alongside caseStatus === 'treated', Close buttons appear.
   * Parent wires this to closeCaseWithOutcome + refetch.
   */
  onCloseWithOutcome?: (outcome: CloseOutcome) => Promise<void>;
}

// ── Rail ──────────────────────────────────────────────────────────────────────

export function CsRecommendedActionRail({
  action, caseStatus, canWrite, onSubmitTreatment, onDismiss, onCloseWithOutcome,
}: RailProps) {
  const prio = PRIORITY_TINT[action.priority];

  // Whether the underlying case is treated — only treated cases can be closed
  // with a KPI outcome (enforces the claim → treat → close loop).
  const isTreated = caseStatus === 'treated';

  // idle | treat-form | dismiss-form | done | dismissed | closed
  const [mode, setMode] = useState<'idle' | 'treat-form' | 'dismiss-form' | 'done' | 'dismissed' | 'closed'>('idle');

  // Separate inline error for the close buttons — they fire directly without a
  // sub-form, so errors surface in-place inside the idle CTA area.
  const [closePending, setClosePending] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  async function handleSubmitTreat(payload: import('./cs-action-rail-forms').TreatmentPayload) {
    await onSubmitTreatment(payload);
    setMode('done');
  }

  async function handleConfirmDismiss(reasonCode: DismissReasonCode) {
    if (!onDismiss) return;
    await onDismiss(reasonCode);
    setMode('dismissed');
  }

  async function handleConfirmClose(outcome: CloseOutcome) {
    if (!onCloseWithOutcome) return;
    setClosePending(true);
    setCloseError(null);
    try {
      await onCloseWithOutcome(outcome);
      setMode('closed');
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : 'Unknown error');
      setClosePending(false);
    }
  }

  return (
    <aside
      style={{
        position: 'sticky', top: 16, alignSelf: 'start',
        background: 'var(--bg-card)', border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden', fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Accent header */}
      <div style={{ padding: '13px 16px', background: 'var(--brand-soft)', borderBottom: '1px solid var(--border-card)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Sparkles size={15} style={{ color: 'var(--brand)' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-hover)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Recommended next action
          </span>
        </div>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Matched playbook + priority */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)' }}>{action.playbookName}</span>
          <span style={{ background: prio.bg, color: prio.ink, fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 'var(--radius-full)' }}>
            {prio.label}
          </span>
        </div>

        <Block label="Why now">{action.why}</Block>

        {/* Channels */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
            Reach out via
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {action.channels.map((ch, i) => (
              <button
                key={ch}
                type="button"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 12.5, fontWeight: 600, fontFamily: 'var(--font-sans)',
                  padding: '7px 13px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  color: i === 0 ? 'var(--text-on-brand)' : 'var(--text-primary)',
                  background: i === 0 ? 'var(--brand)' : 'var(--bg-card)',
                  border: `1px solid ${i === 0 ? 'var(--brand)' : 'var(--border-card)'}`,
                }}
              >
                {CHANNEL_ICON[ch]} {CHANNEL_LABEL[ch]}
              </button>
            ))}
          </div>
        </div>

        <Block label="Talk-track">{action.script}</Block>
        <Block label="Offer">{action.bundle}</Block>

        <div style={{ fontSize: 11, color: 'var(--warning-ink)', background: 'var(--warning-soft)', padding: '7px 10px', borderRadius: 'var(--radius-md)' }}>
          {action.slaNote}
        </div>

        {/* CTA area — states: idle / treat-form / dismiss-form / done / dismissed / closed */}
        {mode === 'done' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', fontSize: 12.5, fontWeight: 700, padding: '11px 14px', borderRadius: 'var(--radius-md)', background: 'var(--success-soft)', color: 'var(--success-ink)' }}>
            <Check size={15} strokeWidth={3} /> Treatment logged
          </div>
        )}

        {mode === 'dismissed' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', fontSize: 12.5, fontWeight: 700, padding: '11px 14px', borderRadius: 'var(--radius-md)', background: 'var(--muted-soft)', color: 'var(--muted-ink)' }}>
            <Ban size={15} /> Case dismissed
          </div>
        )}

        {mode === 'closed' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', fontSize: 12.5, fontWeight: 700, padding: '11px 14px', borderRadius: 'var(--radius-md)', background: 'var(--success-soft)', color: 'var(--success-ink)' }}>
            <Check size={15} strokeWidth={3} /> Case closed · outcome recorded
          </div>
        )}

        {mode === 'treat-form' && (
          <TreatForm onSubmit={handleSubmitTreat} onCancel={() => setMode('idle')} />
        )}

        {mode === 'dismiss-form' && onDismiss && (
          <DismissForm onConfirm={handleConfirmDismiss} onCancel={() => setMode('idle')} />
        )}

        {mode === 'idle' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Treated case: Close-with-outcome buttons replace the treat CTA.
                Gate enforces the claim → treat → close sequence. */}
            {isTreated && onCloseWithOutcome !== undefined ? (
              <>
                {closeError && (
                  <div style={{ fontSize: 11.5, color: 'var(--destructive-ink)', background: 'var(--destructive-soft)', padding: '6px 10px', borderRadius: 'var(--radius-md)' }}>
                    {closeError}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => canWrite && !closePending && handleConfirmClose('kpi_met')}
                  disabled={!canWrite || closePending}
                  title={canWrite ? 'Close — KPI was met' : 'Editor or admin role required'}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)',
                    padding: '11px 14px', borderRadius: 'var(--radius-md)',
                    color: canWrite ? 'var(--success-ink)' : 'var(--border-strong)',
                    background: canWrite ? 'var(--success-soft)' : 'var(--bg-muted)',
                    border: `1px solid ${canWrite ? 'var(--success-ink)' : 'var(--border-card)'}`,
                    cursor: canWrite && !closePending ? 'pointer' : 'not-allowed',
                    opacity: canWrite && !closePending ? 1 : 0.7,
                  }}
                >
                  <Check size={14} strokeWidth={3} /> Close · KPI met
                </button>
                <button
                  type="button"
                  onClick={() => canWrite && !closePending && handleConfirmClose('kpi_missed')}
                  disabled={!canWrite || closePending}
                  title={canWrite ? 'Close — KPI was missed' : 'Editor or admin role required'}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)',
                    padding: '11px 14px', borderRadius: 'var(--radius-md)',
                    color: canWrite ? 'var(--destructive-ink)' : 'var(--border-strong)',
                    background: canWrite ? 'var(--destructive-soft)' : 'var(--bg-muted)',
                    border: `1px solid ${canWrite ? 'var(--destructive-ink)' : 'var(--border-card)'}`,
                    cursor: canWrite && !closePending ? 'pointer' : 'not-allowed',
                    opacity: canWrite && !closePending ? 1 : 0.7,
                  }}
                >
                  <X size={14} strokeWidth={3} /> Close · KPI missed
                </button>
              </>
            ) : !isTreated ? (
              <>
                {/* Primary: treat CTA — open cases only */}
                <button
                  type="button"
                  onClick={() => canWrite && setMode('treat-form')}
                  disabled={!canWrite}
                  title={canWrite ? 'Log treatment for this case' : 'Editor or admin role required to log treatments'}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)',
                    padding: '11px 14px', borderRadius: 'var(--radius-md)',
                    color: 'var(--text-on-brand)', background: canWrite ? 'var(--brand)' : 'var(--border-strong)',
                    border: 0, cursor: canWrite ? 'pointer' : 'not-allowed', opacity: canWrite ? 1 : 0.7,
                  }}
                >
                  Mark treated · log outcome <ArrowRight size={15} />
                </button>

                {/* Secondary: dismiss — only when parent wires onDismiss */}
                {onDismiss !== undefined && (
                  <button
                    type="button"
                    onClick={() => canWrite && setMode('dismiss-form')}
                    disabled={!canWrite}
                    title={canWrite ? 'Dismiss this case with a reason' : 'Editor or admin role required'}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
                      padding: '8px 14px', borderRadius: 'var(--radius-md)',
                      color: canWrite ? 'var(--text-muted)' : 'var(--border-strong)',
                      background: 'transparent', border: '1px solid var(--border-card)',
                      cursor: canWrite ? 'pointer' : 'not-allowed', opacity: canWrite ? 1 : 0.5,
                    }}
                  >
                    <Ban size={13} /> Dismiss
                  </button>
                )}
              </>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}
