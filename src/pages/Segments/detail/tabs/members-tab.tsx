/**
 * Members tab — thin wrapper around SampleUsersTab. Adds an "Export IDs"
 * action above the list so it lives next to where users actually need it.
 */

import { ReactElement } from 'react';
import { Button } from 'antd';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SampleUsersTab } from './sample-users-tab';
import type { Segment } from '../../../../types/segment-api';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
}

export function MembersTab({ segment }: Props): ReactElement {
  const { t } = useTranslation();
  return (
    <div className={styles.membersTab}>
      <header className={styles.membersHeader}>
        <h2 className={styles.membersTitle}>
          {t('segments.detail.members.title', { defaultValue: 'Members' })}
        </h2>
        <Button icon={<Download size={14} />} disabled={(segment.uid_list ?? []).length === 0}>
          {t('segments.detail.actions.exportIds', { defaultValue: 'Export IDs' })}
        </Button>
      </header>
      <SampleUsersTab segment={segment} />
    </div>
  );
}
