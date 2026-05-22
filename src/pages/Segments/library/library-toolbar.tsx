/**
 * Library toolbar — search + sort + identity-settings icon-button, rendered
 * inline inside the filter bar (no own row). Filter pills live in
 * library-filter-pills.tsx; primary actions (Import / + New segment) live
 * in the library title block.
 */

import { ReactElement } from 'react';
import { Input, Select } from 'antd';
import { Search, Settings2 } from 'lucide-react';
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
    <>
      <label className={styles.searchPill}>
        <Search size={14} aria-hidden />
        <Input
          bordered={false}
          placeholder={t('segments.library.search')}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <span className={styles.cmdMod} aria-hidden>⌘K</span>
      </label>
      <Select
        className={styles.sortPill}
        bordered={false}
        value={sort}
        onChange={onSortChange}
        suffixIcon={null}
        options={[
          { value: 'recent', label: t('segments.library.sort.recent') },
          { value: 'name', label: t('segments.library.sort.name') },
          { value: 'size', label: t('segments.library.sort.size') },
        ]}
      />
      <button
        type="button"
        className={styles.identityIconBtn}
        onClick={() => history.push('/segments/identity-map')}
        aria-label={t('segments.library.identityMap', { defaultValue: 'Identity mapping' })}
        title={t('segments.library.identityMap', { defaultValue: 'Identity mapping' })}
      >
        <Settings2 size={16} aria-hidden />
      </button>
    </>
  );
}
