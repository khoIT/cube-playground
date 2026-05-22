/**
 * Members tab — header (title + identity chip + Export button) and the
 * paginated/dim-enriched member table.
 */

import { ReactElement } from 'react';
import { Button } from 'antd';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SampleUsersTab } from './sample-users-tab';
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
          <span className={styles.membersIdentityChip} title={identityDim}>
            {t('segments.detail.members.identityChip', {
              defaultValue: 'Identity: {{dim}}',
              dim: identityDim,
            })}
          </span>
        </div>
        <Button icon={<Download size={14} />} disabled={(segment.uid_list ?? []).length === 0}>
          {t('segments.detail.actions.exportIds', { defaultValue: 'Export IDs' })}
        </Button>
      </header>
      <SampleUsersTab segment={segment} preset={preset} />
    </div>
  );
}
