/**
 * Segmented control for switching between LTV tiers (Top 50 / Middle 50 /
 * Bottom 50, or a single "All N"). Styled with design tokens to match the
 * detail page's tab strip — no new colors or spacing constants.
 */

import { CSSProperties, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TierName } from '../../../../types/segment-api';
import type { TierOption } from './tier-view-model';

interface Props {
  options: TierOption[];
  active: TierName;
  onChange: (tier: TierName) => void;
  /** Disabled while a uid search is active (search spans all tiers). */
  disabled?: boolean;
}

const TIER_LABEL_KEYS: Record<TierName, string> = {
  top: 'segments.detail.members.tiers.top',
  middle: 'segments.detail.members.tiers.middle',
  bottom: 'segments.detail.members.tiers.bottom',
  all: 'segments.detail.members.tiers.all',
};

const TIER_LABEL_DEFAULTS: Record<TierName, string> = {
  top: 'Top {{n}}',
  middle: 'Middle {{n}}',
  bottom: 'Bottom {{n}}',
  all: 'All {{n}}',
};

const groupStyle: CSSProperties = {
  display: 'inline-flex',
  gap: 4,
  padding: 4,
  background: 'var(--bg-muted)',
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-md)',
};

function buttonStyle(isActive: boolean, disabled: boolean): CSSProperties {
  return {
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: isActive ? 600 : 500,
    fontFamily: 'var(--font-sans)',
    cursor: disabled ? 'default' : 'pointer',
    background: isActive ? 'var(--bg-card)' : 'transparent',
    color: disabled
      ? 'var(--text-muted)'
      : isActive
        ? 'var(--text-primary)'
        : 'var(--text-secondary)',
    boxShadow: isActive ? 'var(--shadow-xs)' : 'none',
    opacity: disabled ? 0.6 : 1,
  };
}

export function TierSelector({ options, active, onChange, disabled = false }: Props): ReactElement {
  const { t } = useTranslation();
  return (
    <div role="tablist" aria-label={t('segments.detail.members.tiers.eyebrow', { defaultValue: 'LTV sampling' })} style={groupStyle}>
      {options.map((opt) => {
        const isActive = opt.name === active && !disabled;
        return (
          <button
            key={opt.name}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={disabled}
            onClick={() => onChange(opt.name)}
            style={buttonStyle(isActive, disabled)}
          >
            {t(TIER_LABEL_KEYS[opt.name], {
              defaultValue: TIER_LABEL_DEFAULTS[opt.name],
              n: opt.count,
            })}
          </button>
        );
      })}
    </div>
  );
}
