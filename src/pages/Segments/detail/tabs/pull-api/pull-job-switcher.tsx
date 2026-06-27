/**
 * Job-to-be-done switcher for the Pull API tab. Two captioned intent cards let
 * the two distinct audiences who land here self-select: a downstream developer
 * ("Build the integration") vs. the owner/admin ("Monitor consumption"). Framing
 * the toggle as jobs (with one-line captions) rather than terse nouns makes the
 * tab's dual purpose legible on a cold landing. Monitor is admin-gated, so this
 * only renders when there's more than one job to choose.
 */

import { ReactElement } from 'react';
import { Plug, Activity } from 'lucide-react';

export type PullJob = 'build' | 'monitor';

const card = (active: boolean): React.CSSProperties => ({
  position: 'relative',
  display: 'flex',
  gap: 12,
  alignItems: 'flex-start',
  background: active ? 'var(--brand-soft)' : 'var(--bg-card)',
  border: `1.5px solid ${active ? 'var(--brand)' : 'var(--border-card)'}`,
  boxShadow: active ? '0 0 0 3px rgba(240,90,34,0.10)' : 'none',
  borderRadius: 'var(--radius-xl)',
  padding: '14px 16px',
  cursor: 'pointer',
  textAlign: 'left',
  font: 'inherit',
  transition: 'border-color .15s, background .15s, box-shadow .15s',
});

const icon = (active: boolean): React.CSSProperties => ({
  width: 34,
  height: 34,
  flex: 'none',
  borderRadius: 'var(--radius-md)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: active ? 'var(--bg-card)' : 'var(--bg-muted)',
  border: `1px solid ${active ? 'var(--brand-border, #f6c5a8)' : 'var(--border-card)'}`,
  color: active ? 'var(--brand)' : 'var(--text-muted)',
});

const radio = (active: boolean): React.CSSProperties => ({
  position: 'absolute',
  top: 14,
  right: 14,
  width: 16,
  height: 16,
  borderRadius: '50%',
  border: `2px solid ${active ? 'var(--brand)' : 'var(--border-strong)'}`,
  background: active ? 'var(--brand)' : 'var(--bg-card)',
  boxShadow: active ? 'inset 0 0 0 2px var(--bg-card)' : 'none',
});

function JobCard({
  active,
  onClick,
  glyph,
  title,
  caption,
  adminTag,
}: {
  active: boolean;
  onClick: () => void;
  glyph: ReactElement;
  title: string;
  caption: string;
  adminTag?: boolean;
}): ReactElement {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} style={card(active)}>
      <span style={radio(active)} aria-hidden />
      <span style={icon(active)}>{glyph}</span>
      <span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          {title}
          {adminTag && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                padding: '2px 6px',
                borderRadius: 'var(--radius-sm)',
                background: 'color-mix(in srgb, var(--layer-segment, #725390) 12%, var(--bg-card))',
                color: 'var(--layer-segment, #725390)',
              }}
            >
              admin
            </span>
          )}
        </span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.45, paddingRight: 18 }}>
          {caption}
        </span>
      </span>
    </button>
  );
}

export function PullJobSwitcher({ active, onChange }: { active: PullJob; onChange: (j: PullJob) => void }): ReactElement {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
      <JobCard
        active={active === 'build'}
        onClick={() => onChange('build')}
        glyph={<Plug size={18} aria-hidden />}
        title="Build the integration"
        caption="id, endpoint, pagination & code to pull this cohort"
      />
      <JobCard
        active={active === 'monitor'}
        onClick={() => onChange('monitor')}
        glyph={<Activity size={18} aria-hidden />}
        title="Monitor consumption"
        caption="schedule, entitled keys, pulls & health"
        adminTag
      />
    </div>
  );
}
