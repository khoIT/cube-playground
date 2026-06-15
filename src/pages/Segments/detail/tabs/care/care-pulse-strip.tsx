/**
 * Slim pulse strip (Care tab header). One row of headline counts: contacted X/N
 * + coverage %, open, negative, ≤2★, with the coverage caveat surfaced as a
 * tooltip — Facebook/AIHelp tickets don't join, so coverage is partial by design.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CsCareCoverage, CsCarePulse } from '../../../../../api/segment-cs-care';
import { Chip } from './care-ui-atoms';

interface Props {
  coverage: CsCareCoverage;
  pulse: CsCarePulse;
  freshnessDate: string | null;
}

function Stat({ value, label, color }: { value: number; label: string; color?: string }): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontSize: 20, fontWeight: 700, color: color ?? 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  );
}

const Divider = (): ReactElement => (
  <div style={{ width: 1, height: 26, background: 'var(--border-card)' }} aria-hidden />
);

export function CarePulseStrip({ coverage, pulse, freshnessDate }: Props): ReactElement {
  const { t } = useTranslation();
  const pct = coverage.pct == null ? '—' : `${coverage.pct.toFixed(1)}%`;
  const coverageCaveat = t('segments.detail.care.coverageCaveat', {
    defaultValue: 'Only in-game/web/phone tickets join by player id; Facebook/AIHelp (~90% of volume) use a channel id and are excluded.',
  });

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }} title={coverageCaveat}>
        <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--brand)', fontVariantNumeric: 'tabular-nums' }}>
          {coverage.contactedMembers}
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          / {coverage.totalMembers} {t('segments.detail.care.contacted', { defaultValue: 'contacted' })}
        </span>
        <span style={{ marginLeft: 4 }}>
          <Chip tone="neu">{pct}</Chip>
        </span>
      </div>
      <Divider />
      <Stat value={pulse.openUnresolved} label={t('segments.detail.care.open', { defaultValue: 'open' })} color="var(--warning-ink)" />
      <Stat value={pulse.negativeSentiment} label={t('segments.detail.care.negative', { defaultValue: 'negative' })} color="var(--negative)" />
      <Stat value={pulse.lowRating} label={t('segments.detail.care.lowRating', { defaultValue: '≤2★' })} color="var(--negative)" />
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{ fontSize: 11.5, color: 'var(--text-muted)', borderBottom: '1px dotted var(--fill-muted)', cursor: 'help' }}
          title={coverageCaveat}
        >
          {t('segments.detail.care.coverageInfo', { defaultValue: 'coverage caveat' })}
        </span>
        {freshnessDate && (
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            · {t('segments.detail.care.fresh', { defaultValue: 'CS data to {{date}}', date: freshnessDate })}
          </span>
        )}
      </div>
    </div>
  );
}
