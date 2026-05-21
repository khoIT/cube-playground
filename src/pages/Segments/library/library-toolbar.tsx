/**
 * Library toolbar — search + sort + identity-settings icon-button.
 * Filter pills moved to library-filter-pills.tsx; primary actions
 * (Import / + New segment) live in the library title block.
 */

import { ReactElement } from 'react';
import { Button, Input, Select } from 'antd';
import { Settings2 } from 'lucide-react';
import { useHistory } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styles from '../segments.module.css';

export type LibrarySort = 'recent' | 'name' | 'size';

interface Props {
  query: string;
  sort: LibrarySort;
  onQueryChange: (q: string) => void;
  onSortChange: (s: LibrarySort) => void;
}

export function LibraryToolbar({
  query,
  sort,
  onQueryChange,
  onSortChange,
}: Props): ReactElement {
  const { t } = useTranslation();
  const history = useHistory();

  return (
    <div className={styles.toolbar}>
      <Input.Search
        className={styles.search}
        placeholder={t('segments.library.search')}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        allowClear
      />
      <Select
        size="middle"
        style={{ width: 200 }}
        value={sort}
        onChange={onSortChange}
        options={[
          { value: 'recent', label: t('segments.library.sort.recent') },
          { value: 'name', label: t('segments.library.sort.name') },
          { value: 'size', label: t('segments.library.sort.size') },
        ]}
      />
      <div style={{ flex: 1 }} />
      <Button
        icon={<Settings2 size={14} />}
        onClick={() => history.push('/segments/identity-map')}
        title={t('segments.library.identityMap', { defaultValue: 'Identity mapping' })}
      >
        {t('segments.library.identityMap', { defaultValue: 'Identity mapping' })}
      </Button>
    </div>
  );
}
