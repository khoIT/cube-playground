/**
 * Members tab — header (title + identity chip) and the paginated/dim-enriched
 * member table. Export lives in the table's controls row ("Export all IDs") —
 * one export affordance, wired to the full uid_list.
 */

import { ReactElement } from 'react';
import { Tooltip } from 'antd';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SampleUsersTab } from './sample-users-tab';
import { AutoPresetBanner } from '../../components/auto-preset-banner';
import type { Segment } from '../../../../types/segment-api';
import type { Preset } from '../../presets/types';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
  preset: Preset | null;
}

export function MembersTab({ segment, preset }: Props): ReactElement {
  const { t } = useTranslation();
  const identityDim = preset?.identityDim ?? `${segment.cube ?? ''}.user_id`;
  return (
    <div className={styles.membersTab}>
      <header className={styles.membersHeader}>
        <div className={styles.membersHeaderTitleBlock}>
          <h2 className={styles.membersTitle}>
            {t('segments.detail.members.title', { defaultValue: 'Members' })}
          </h2>
          {/* Identity dim demoted to an info tooltip — analysts rarely need
              it; the chip was stealing title-row attention. */}
          <Tooltip
            title={t('segments.detail.members.identityChip', {
              defaultValue: 'Identity: {{dim}}',
              dim: identityDim,
            })}
          >
            <button
              type="button"
              className={styles.membersIdentityInfo}
              aria-label={t('segments.detail.members.identityChip', {
                defaultValue: 'Identity: {{dim}}',
                dim: identityDim,
              })}
            >
              <Info size={14} aria-hidden />
            </button>
          </Tooltip>
        </div>
      </header>
      {preset?.auto && (
        <AutoPresetBanner
          cube={preset.hubCube}
          bodyKey="segments.detail.autoPreset.membersBody"
          bodyDefault="No canonical per-user info is configured for {{cube}}. The members table shows identity only — install a curated preset to add columns like LTV, country, or last activity."
        />
      )}
      <SampleUsersTab segment={segment} preset={preset} />
    </div>
  );
}
