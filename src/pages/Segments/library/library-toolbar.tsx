/** Library toolbar — search, type filter, sort select, Import/New buttons. */

import { ReactElement } from 'react';
import { Button, Input, Select } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { useHistory } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styles from '../segments.module.css';

export type LibraryFilter = 'all' | 'live' | 'static';
export type LibrarySort = 'recent' | 'name' | 'size';

interface Props {
  query: string;
  filter: LibraryFilter;
  sort: LibrarySort;
  onQueryChange: (q: string) => void;
  onFilterChange: (f: LibraryFilter) => void;
  onSortChange: (s: LibrarySort) => void;
  onImport?: () => void;
  onNew?: () => void;
}

export function LibraryToolbar({
  query,
  filter,
  sort,
  onQueryChange,
  onFilterChange,
  onSortChange,
  onImport,
  onNew,
}: Props): ReactElement {
  const { t } = useTranslation();
  const history = useHistory();
  const filters: LibraryFilter[] = ['all', 'live', 'static'];

  return (
    <div className={styles.toolbar}>
      <Input.Search
        className={styles.search}
        placeholder={t('segments.library.search')}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        allowClear
      />
      <div className={styles.filterTabs} role="tablist" aria-label="Type filter">
        {filters.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={[
              styles.filterTab,
              filter === key ? styles.filterTabActive : '',
            ].filter(Boolean).join(' ')}
            onClick={() => onFilterChange(key)}
          >
            {t(`segments.library.filter.${key}`)}
          </button>
        ))}
      </div>
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
        icon={<SettingOutlined />}
        onClick={() => history.push('/segments/identity-map')}
        title="Identity mapping"
      >
        Identity mapping
      </Button>
      <Button onClick={onImport}>{t('segments.library.import')}</Button>
      <Button type="primary" onClick={onNew}>{t('segments.library.new')}</Button>
    </div>
  );
}
