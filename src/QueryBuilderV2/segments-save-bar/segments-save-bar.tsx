/**
 * Floating action bar shown beneath QueryBuilderResults when the executed query
 * contains a mapped identity dimension. Lets the user push the visible result
 * set into a segment without leaving Playground.
 *
 * Additive: does not modify the existing table render path. Reads from the
 * QueryBuilder context that's already in scope of QueryBuilderResults.
 */

import { ReactElement, useMemo, useState } from 'react';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useIdentityMap } from '../../hooks/use-identity-map';
import { PushModal } from '../../pages/Segments/push-modal/push-modal';

interface Props {
  /** Query that was actually executed (not the working query). */
  executedQuery: {
    dimensions?: string[];
    measures?: string[];
    filters?: unknown[];
  } | null;
  /** Result rows currently displayed. */
  rows: Record<string, unknown>[];
}

function inferCubeAndIdentity(
  executedQuery: Props['executedQuery'],
  hasIdentityFor: (cube: string) => boolean,
  identityFieldFor: (cube: string) => string | null,
): { cube: string | null; identityField: string | null } {
  if (!executedQuery?.dimensions?.length) return { cube: null, identityField: null };
  for (const dim of executedQuery.dimensions) {
    const cube = dim.split('.')[0];
    if (hasIdentityFor(cube) && identityFieldFor(cube) === dim) {
      return { cube, identityField: dim };
    }
  }
  return { cube: null, identityField: null };
}

export function SegmentsSaveBar({ executedQuery, rows }: Props): ReactElement | null {
  const { t } = useTranslation();
  const { hasIdentityFor, identityFieldFor } = useIdentityMap();
  const [modalOpen, setModalOpen] = useState(false);

  const { cube, identityField } = useMemo(
    () => inferCubeAndIdentity(executedQuery, hasIdentityFor, identityFieldFor),
    [executedQuery, hasIdentityFor, identityFieldFor],
  );

  const uids = useMemo(() => {
    if (!identityField) return [];
    return rows
      .map((r) => r[identityField])
      .filter((v): v is string | number => v != null)
      .map((v) => String(v));
  }, [identityField, rows]);

  if (!identityField || uids.length === 0) return null;

  return (
    <>
      <div
        role="region"
        aria-label="Save as segment"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          background: 'var(--bg-card)',
          borderTop: '1px solid var(--border-card)',
          fontSize: 13,
        }}
      >
        <span style={{ color: 'var(--text-secondary)' }}>
          {t('segments.selectionBar.selected', { count: uids.length })}
        </span>
        <span style={{ flex: 1 }} />
        <Button type="primary" onClick={() => setModalOpen(true)}>
          {t('segments.selectionBar.saveAs')}
        </Button>
      </div>
      <PushModal
        open={modalOpen}
        uids={uids}
        rows={rows}
        cube={cube}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
