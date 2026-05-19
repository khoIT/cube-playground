/** Placeholder body shown for detail tabs whose content is filled by later phases. */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../segments.module.css';

interface Props {
  phase: 4 | 5 | 7;
}

export function TabPending({ phase }: Props): ReactElement {
  const { t } = useTranslation();
  return (
    <div className={styles.tabPending} role="status">
      {t('segments.detail.pending', { phase: `P${phase}` })}
    </div>
  );
}
