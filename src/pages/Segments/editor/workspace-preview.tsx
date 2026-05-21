/**
 * Right rail for the editor workspace. Surfaces the live preview (est. size +
 * SQL preview) using the existing ResolvedCohortCard + SqlPreviewCard, wrapped
 * in the workspace shell with a header and footnote.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ResolvedCohortCard } from './right-rail/resolved-cohort-card';
import { SqlPreviewCard } from './right-rail/sql-preview-card';
import styles from '../segments.module.css';

interface PreviewState {
  count: number | null;
  loading: boolean;
  error: string | null;
  ringBuffer: number[];
  sql: string | null;
}

interface Props {
  preview: PreviewState;
}

export function WorkspacePreview({ preview }: Props): ReactElement {
  const { t } = useTranslation();

  return (
    <aside className={styles.workspacePreview}>
      <header className={styles.workspacePreviewHead}>
        <h3>{t('segments.editor.preview.title', { defaultValue: 'Live preview' })}</h3>
      </header>
      <ResolvedCohortCard
        count={preview.count}
        loading={preview.loading}
        error={preview.error}
        ringBuffer={preview.ringBuffer}
      />
      <SqlPreviewCard sql={preview.sql} loading={preview.loading} />
      <p className={styles.workspacePreviewFoot}>
        {t('segments.editor.preview.footnote', {
          defaultValue: 'Preview re-runs as you edit. Identity column changes invalidate the cache.',
        })}
      </p>
    </aside>
  );
}
