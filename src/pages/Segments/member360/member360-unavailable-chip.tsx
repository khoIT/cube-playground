/**
 * Member360UnavailableChip — a single, calm "not a dead end" affordance shown
 * in the Members tab when a segment's game has no Member 360 dashboard.
 *
 * Why a chip (not a per-row state): the uid links simply render as plain text
 * when 360 is off; without this, a viewer can't tell whether 360 is broken or
 * just not built for this game. One disabled chip + tooltip explains the gap
 * and points at the gating layer, without per-row noise.
 *
 * Tokens only; muted/disabled styling so it reads as informational, not error.
 */

import { ReactElement } from 'react';
import { Tooltip } from 'antd';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  gameId: string | null | undefined;
}

export function Member360UnavailableChip({ gameId }: Props): ReactElement {
  const { t } = useTranslation();
  return (
    <Tooltip
      title={t('segments.member360.unavailableTooltip', {
        defaultValue:
          'No Member 360 dashboard is configured for this game yet. It needs Cube model coverage for the 360 views before per-member profiles can render.',
      })}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 10px',
          borderRadius: 'var(--radius-pill)',
          background: 'var(--bg-muted)',
          color: 'var(--text-muted)',
          border: '1px solid var(--border-card)',
          fontSize: 11.5,
          fontWeight: 600,
          fontFamily: 'var(--font-sans)',
          cursor: 'help',
        }}
        data-testid="member360-unavailable-chip"
        aria-label={t('segments.member360.unavailableAria', {
          defaultValue: 'Member 360 unavailable for this game',
        })}
      >
        <Info size={12} aria-hidden />
        {t('segments.member360.unavailableLabel', { defaultValue: 'Member 360 unavailable' })}
        {gameId ? ` · ${gameId}` : ''}
      </span>
    </Tooltip>
  );
}

export default Member360UnavailableChip;
