/**
 * CS-impact rail widget (Direction B) — contacted vs not-contacted cohort
 * recharge delta around the first ticket date, as two mini pre/post bar pairs.
 * Always carries the "directional, small sample" caption: at whale-segment
 * scale (n≈22) this is a signal to investigate, never a significance claim.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CsCareImpact, CsCareCohortStats } from '../../../../../api/segment-cs-care';
import { fmtPct } from './care-ui-atoms';

interface Props {
  impact: CsCareImpact;
}

function deltaColor(p: number | null): string {
  if (p == null) return 'var(--text-secondary)';
  if (p <= -10) return 'var(--negative)';
  if (p >= 10) return 'var(--positive)';
  return 'var(--text-secondary)';
}

/** Two bars (pre/post) scaled to the cohort's own max so the shape is readable. */
function Cohort({ label, stats }: { label: string; stats: CsCareCohortStats }): ReactElement {
  const max = Math.max(1, stats.avgRevPre, stats.avgRevPost);
  const h = (v: number) => Math.max(4, Math.round((v / max) * 40));
  const negative = (stats.deltaPct ?? 0) <= -10;
  return (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: deltaColor(stats.deltaPct), fontVariantNumeric: 'tabular-nums' }}>
        {fmtPct(stats.deltaPct)}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 8, height: 44, marginTop: 8 }}>
        <span style={{ width: 22, height: h(stats.avgRevPre), background: 'var(--neutral-300)', borderRadius: '3px 3px 0 0' }} />
        <span
          style={{
            width: 22,
            height: h(stats.avgRevPost),
            background: negative ? 'var(--brand)' : 'var(--neutral-400)',
            borderRadius: '3px 3px 0 0',
          }}
        />
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6 }}>
        {label} · n={stats.n}
      </div>
    </div>
  );
}

export function CareImpactStrip({ impact }: Props): ReactElement {
  const { t } = useTranslation();
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-alt)',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          marginBottom: 12,
        }}
      >
        {t('segments.detail.care.impactTitle', {
          defaultValue: 'Recharge {{days}}d before → after contact',
          days: impact.windowDays,
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
        <Cohort label={t('segments.detail.care.contactedShort', { defaultValue: 'Contacted' })} stats={impact.contacted} />
        <div style={{ width: 1, height: 60, background: 'var(--border-card)' }} aria-hidden />
        <Cohort label={t('segments.detail.care.notContactedShort', { defaultValue: 'Not contacted' })} stats={impact.nonContacted} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 12 }}>
        {impact.smallSample
          ? t('segments.detail.care.directionalSmall', {
              defaultValue: '◆ Directional, small sample (n={{n}}). Not a significance claim.',
              n: impact.contacted.n,
            })
          : t('segments.detail.care.directional', { defaultValue: '◆ Directional — recharge association, not causation.' })}
      </div>
    </div>
  );
}
