/**
 * SegmentCreatedCard — the post-creation "created" state of SegmentProposalCard.
 *
 * 3B "success banner + receipt" layout: a top success banner ("Segment created
 * in {game}"), then a read-only receipt of exactly what was written — name,
 * filter chips, and a Final size / Status / Visibility stat row — under a split
 * footer (primary "View segment" + secondary "Create another").
 *
 * The created state survives a chat reload: SegmentProposalCard persists the
 * created segment id (keyed by proposal content) and re-hydrates this card with
 * fresh status/count on mount. Navigation is allowed even while
 * status='refreshing' — the segment detail page renders its own building state.
 */
import React from 'react';
import { ArrowRight, CheckCircle, Plus } from 'lucide-react';
import { T, Icon } from '../../../shell/theme';
import type { Segment, SegmentVisibility } from '../../../types/segment-api';
import { PredicateChip } from './segment-proposal-card-parts';

interface SegmentCreatedCardProps {
  segment: Segment;
  /** Predicate leaf chips (already capped) + overflow count, mirrored from the proposal. */
  chips: string[];
  overflowCount: number;
  onView: () => void;
  onCreateAnother: () => void;
  /** 'created' (default) for a brand-new segment; 'updated' for an in-place edit. */
  mode?: 'created' | 'updated';
}

/** Status row colour + label per segment lifecycle state. Refreshing pulses. */
function statusView(status: Segment['status']): { color: string; label: string; pulsing: boolean } {
  switch (status) {
    case 'refreshing': return { color: 'var(--warning-ink)', label: 'Refreshing', pulsing: true };
    case 'fresh': return { color: 'var(--success-ink)', label: 'Fresh', pulsing: false };
    case 'broken': return { color: 'var(--destructive-ink)', label: 'Broken', pulsing: false };
    default: return { color: 'var(--shell-text-muted)', label: 'Stale', pulsing: false };
  }
}

const VISIBILITY_LABEL: Record<SegmentVisibility, string> = {
  personal: 'Personal',
  shared: 'Workspace',
  org: 'Org-wide',
};

const lblStyle: React.CSSProperties = {
  fontFamily: T.fSans, fontSize: 11, fontWeight: 600, color: 'var(--shell-text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.06em',
};

export function SegmentCreatedCard({ segment, chips, overflowCount, onView, onCreateAnother, mode = 'created' }: SegmentCreatedCardProps) {
  const st = statusView(segment.status);
  const isUpdated = mode === 'updated';

  return (
    <div
      style={{
        border: '1px solid var(--border-strong)',
        borderRadius: 12,
        background: 'var(--surface-raised)',
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
        width: '100%',
        maxWidth: 560,
        margin: '12px 0',
      }}
    >
      {/* Success banner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 20px', background: 'var(--success-soft)', borderLeft: '3px solid var(--success-ink)' }}>
        <Icon icon={CheckCircle} size={15} color="var(--success-ink)" />
        <span style={{ fontFamily: T.fSans, fontSize: 13.5, fontWeight: 600, color: 'var(--success-ink)' }}>
          {isUpdated ? 'Segment updated' : 'Segment created'} in {segment.game_id}
        </span>
      </div>

      {/* Receipt body */}
      <div style={{ padding: '15px 20px', display: 'flex', flexDirection: 'column', gap: 13 }}>
        {/* Name — read-only, clickable through to the segment */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lblStyle}>Name</span>
          <button
            type="button"
            onClick={onView}
            title="Open segment"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, alignSelf: 'flex-start',
              padding: 0, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left',
              fontFamily: T.fSans, fontSize: 15, fontWeight: 700, color: 'var(--shell-text)',
            }}
          >
            {segment.name}
            <Icon icon={ArrowRight} size={13} color="var(--brand)" />
          </button>
        </div>

        {/* Filter receipt */}
        {chips.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={lblStyle}>Filters</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {chips.map((chip, i) => <PredicateChip key={i} label={chip.trim()} />)}
              {overflowCount > 0 && (
                <span style={{ fontFamily: T.fSans, fontSize: 11, color: 'var(--shell-text-faint)' }}>+{overflowCount} more</span>
              )}
            </div>
          </div>
        )}

        {/* Stats: final size / status / visibility */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={lblStyle}>Final size</span>
            <span style={{ fontFamily: T.fSans, fontSize: 14, fontWeight: 600, color: 'var(--shell-text)', fontVariantNumeric: 'tabular-nums' }}>
              {segment.uid_count.toLocaleString()} users
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={lblStyle}>Status</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: T.fSans, fontSize: 14, fontWeight: 600, color: st.color }}>
              <span
                style={{
                  width: 7, height: 7, borderRadius: '50%', background: st.color, display: 'inline-block',
                  animation: st.pulsing ? 'segCreatedPulse 1.6s ease-out infinite' : undefined,
                }}
              />
              {st.label}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={lblStyle}>Visibility</span>
            <span style={{ fontFamily: T.fSans, fontSize: 14, fontWeight: 600, color: 'var(--shell-text)' }}>
              {VISIBILITY_LABEL[segment.visibility] ?? 'Personal'}
            </span>
          </div>
        </div>
      </div>

      {/* Footer: primary View (brand) + secondary Create another */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 20px', borderTop: '1px solid var(--shell-bg-subtle)', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onView}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '7px 16px', borderRadius: 6, border: 'none', background: 'var(--brand)', cursor: 'pointer',
            fontFamily: T.fSans, fontSize: 13, fontWeight: 600, color: 'var(--text-on-brand)',
          }}
        >
          <Icon icon={ArrowRight} size={13} color="var(--text-on-brand)" />
          View segment
        </button>
        <button
          type="button"
          onClick={onCreateAnother}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border-card)', background: 'var(--bg-card)', cursor: 'pointer',
            fontFamily: T.fSans, fontSize: 12, fontWeight: 500, color: 'var(--shell-text-secondary)',
          }}
        >
          <Icon icon={Plus} size={13} color="var(--shell-text-secondary)" />
          {isUpdated ? 'Done' : 'Create another'}
        </button>
      </div>

      <style>{'@keyframes segCreatedPulse{0%{box-shadow:0 0 0 0 rgba(138,90,0,.45)}70%{box-shadow:0 0 0 6px rgba(138,90,0,0)}100%{box-shadow:0 0 0 0 rgba(138,90,0,0)}}'}</style>
    </div>
  );
}
