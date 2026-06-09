/**
 * Care-history timeline — the central action surface of the CS Member-360.
 *
 * A vertical spine of care events (open matches → treatments → resolutions),
 * each a card with the matched playbook, channel, agent, KPI before→after, and
 * outcome. Data is the illustrative SAMPLE (see cs-member360-mock) — treatment
 * outcomes aren't captured in the ledger yet — so the header carries a clear
 * "sample" tag. The live open-case count (from the real ledger) anchors it.
 *
 * Tokens only; semantic status pairs adapt to dark mode.
 */

import { Clock, Phone, MessageSquare, Gamepad2, Mail, Check, X, Sparkles } from 'lucide-react';
import type {
  CareTimelineEvent,
  CareEventKind,
  CarePriority,
  CareChannel,
  CareOutcome,
} from './cs-member360-mock';
import { CHANNEL_LABEL } from './cs-member360-mock';

const PRIORITY_TINT: Record<CarePriority, { bg: string; ink: string; label: string }> = {
  cao: { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', label: 'Cao' },
  tb: { bg: 'var(--info-soft)', ink: 'var(--info-ink)', label: 'TB' },
  thap: { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)', label: 'Thấp' },
};

const KIND_META: Record<CareEventKind, { dot: string; ring: string; label: string }> = {
  opened: { dot: 'var(--brand)', ring: 'var(--brand-soft)', label: 'Matched · open' },
  treated: { dot: 'var(--info-ink)', ring: 'var(--info-soft)', label: 'Treated' },
  resolved: { dot: 'var(--success-ink)', ring: 'var(--success-soft)', label: 'Resolved' },
  note: { dot: 'var(--text-muted)', ring: 'var(--bg-muted)', label: 'Note' },
};

const CHANNEL_ICON: Record<CareChannel, React.ReactNode> = {
  call: <Phone size={11} />,
  zalo_zns: <MessageSquare size={11} />,
  in_game: <Gamepad2 size={11} />,
  email: <Mail size={11} />,
};

function relDay(daysAgo: number): string {
  if (daysAgo === 0) return 'today';
  if (daysAgo === 1) return 'yesterday';
  return `${daysAgo}d ago`;
}

function OutcomeChip({ outcome }: { outcome: CareOutcome }) {
  const map = {
    kpi_met: { bg: 'var(--success-soft)', ink: 'var(--success-ink)', icon: <Check size={11} strokeWidth={3} />, label: 'KPI met' },
    kpi_missed: { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', icon: <X size={11} strokeWidth={3} />, label: 'KPI missed' },
    pending: { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)', icon: <Clock size={11} />, label: 'Awaiting KPI' },
  }[outcome];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: map.bg, color: map.ink }}>
      {map.icon} {map.label}
    </span>
  );
}

function EventCard({ e }: { e: CareTimelineEvent }) {
  const prio = PRIORITY_TINT[e.priority];
  return (
    <div
      style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-lg)', padding: '12px 14px', boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: e.note ? 7 : 0 }}>
        <span style={{ ...{ background: prio.bg, color: prio.ink }, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 'var(--radius-full)', whiteSpace: 'nowrap' }}>
          {e.playbookName}
        </span>
        {e.channel && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>
            {CHANNEL_ICON[e.channel]} {CHANNEL_LABEL[e.channel]}
          </span>
        )}
        {e.outcome && <OutcomeChip outcome={e.outcome} />}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
          <Clock size={11} /> {relDay(e.daysAgo)}
        </span>
      </div>

      {e.kpi && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--text-secondary)', margin: '0 0 6px' }}>
          <span style={{ fontWeight: 600 }}>{e.kpi.label}:</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{e.kpi.before}</span>
          {e.kpi.after != null && (
            <>
              <span style={{ color: 'var(--text-muted)' }}>→</span>
              <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{e.kpi.after}</span>
            </>
          )}
        </div>
      )}

      {e.note && <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{e.note}</p>}
      {e.agent && (
        <div style={{ marginTop: 7, fontSize: 10.5, color: 'var(--text-muted)' }}>by {e.agent}</div>
      )}
    </div>
  );
}

interface TimelineProps {
  events: CareTimelineEvent[];
  /** Real open-case count from the ledger, anchoring the sample. */
  openCount: number | null;
}

export function CsCareHistoryTimeline({ events, openCount }: TimelineProps) {
  return (
    <section>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>
          Care history
        </h2>
        {openCount != null && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 'var(--radius-full)', background: 'var(--brand-soft)', color: 'var(--brand-hover)' }}>
            {openCount} open
          </span>
        )}
        <span
          title="Treatment outcomes are not captured in the ledger yet — this lifecycle is illustrative."
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, padding: '2px 9px', borderRadius: 'var(--radius-full)', background: 'var(--warning-soft)', color: 'var(--warning-ink)' }}
        >
          <Sparkles size={11} /> sample
        </span>
      </header>

      {/* Spine + nodes */}
      <div style={{ position: 'relative', paddingLeft: 26 }}>
        <div style={{ position: 'absolute', left: 7, top: 6, bottom: 6, width: 2, background: 'var(--border-card)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {events.map((e) => {
            const meta = KIND_META[e.kind];
            return (
              <div key={e.id} style={{ position: 'relative' }}>
                {/* node */}
                <span
                  aria-hidden
                  style={{
                    position: 'absolute', left: -26, top: 6, width: 16, height: 16,
                    borderRadius: '50%', background: meta.dot,
                    boxShadow: `0 0 0 4px ${meta.ring}`,
                  }}
                />
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 5 }}>
                  {meta.label}
                </div>
                <EventCard e={e} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
