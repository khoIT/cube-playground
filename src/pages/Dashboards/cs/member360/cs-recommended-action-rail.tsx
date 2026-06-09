/**
 * Recommended-next-action rail — the decision sidekick beside the care timeline.
 *
 * Surfaces the single most-urgent open match as a "do this next" card: why the
 * VIP surfaced, suggested outreach channels, a talk-track, a bundle to offer, and
 * the SLA. "Mark treated · log outcome" is a visual stub for this round — it
 * optimistically logs a sample treatment to the timeline client-side (clearly
 * labelled) without persisting, demonstrating the flow end-to-end.
 *
 * Tokens only; semantic status pairs.
 */

import { Phone, MessageSquare, Gamepad2, Mail, Sparkles, Check, ArrowRight } from 'lucide-react';
import type { RecommendedAction, CarePriority, CareChannel } from './cs-member360-mock';
import { CHANNEL_LABEL } from './cs-member360-mock';

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

interface RailProps {
  action: RecommendedAction;
  treated: boolean;
  onMarkTreated: () => void;
  canWrite: boolean;
}

export function CsRecommendedActionRail({ action, treated, onMarkTreated, canWrite }: RailProps) {
  const prio = PRIORITY_TINT[action.priority];

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
                  color: i === 0 ? '#fff' : 'var(--text-primary)',
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

        {/* CTA / treated confirmation */}
        {treated ? (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
              fontSize: 12.5, fontWeight: 700, padding: '11px 14px', borderRadius: 'var(--radius-md)',
              background: 'var(--success-soft)', color: 'var(--success-ink)',
            }}
          >
            <Check size={15} strokeWidth={3} /> Logged to timeline (sample)
          </div>
        ) : (
          <button
            type="button"
            onClick={onMarkTreated}
            disabled={!canWrite}
            title={canWrite ? 'Log a sample treatment to the timeline (does not persist this round)' : 'Editor or admin role required to log treatments'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)',
              padding: '11px 14px', borderRadius: 'var(--radius-md)',
              color: '#fff', background: canWrite ? 'var(--brand)' : 'var(--border-strong)',
              border: 0, cursor: canWrite ? 'pointer' : 'not-allowed', opacity: canWrite ? 1 : 0.7,
            }}
          >
            Mark treated · log outcome <ArrowRight size={15} />
          </button>
        )}
        <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
          Outreach + outcome logging is a preview — actions don’t persist yet.
        </div>
      </div>
    </aside>
  );
}
