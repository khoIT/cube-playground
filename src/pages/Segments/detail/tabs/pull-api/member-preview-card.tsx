/**
 * Live member preview — the first page of the segment's ranked snapshot as mono
 * chips (friendly name + uid when the game models one), with "load more". Self-
 * contained: owns its own paginated fetch off segment id.
 */

import { ReactElement, useCallback, useEffect, useState } from 'react';
import { message } from 'antd';
import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { segmentsClient, type SegmentMemberRow, type SegmentMembersPage } from '../../../../../api/segments-client';

const PREVIEW_LIMIT = 25;

export function MemberPreviewCard({ segmentId }: { segmentId: string }): ReactElement {
  const { t } = useTranslation();
  const [page, setPage] = useState<SegmentMembersPage | null>(null);
  const [preview, setPreview] = useState<SegmentMemberRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    segmentsClient
      .members(segmentId, { limit: PREVIEW_LIMIT })
      .then((p) => {
        if (!live) return;
        setPage(p);
        setPreview(p.members);
        setCursor(p.next_cursor);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Failed to load members'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [segmentId]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    try {
      const p = await segmentsClient.members(segmentId, { cursor, limit: PREVIEW_LIMIT });
      setPreview((prev) => [...prev, ...p.members]);
      setCursor(p.next_cursor);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to load more');
    }
  }, [cursor, segmentId]);

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-xl)', padding: '18px 20px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
          <KeyRound size={13} aria-hidden /> {t('segments.detail.pullApi.preview', { defaultValue: 'Member preview' })}
        </h3>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          {t('segments.detail.pullApi.previewCount', {
            defaultValue: 'showing {{n}} of {{total}}',
            n: preview.length,
            total: (page?.total_count ?? 0).toLocaleString(),
          })}
        </span>
      </div>
      {loading && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('common.loading', { defaultValue: 'Loading…' })}</div>}
      {error && <div style={{ color: 'var(--destructive-ink)', fontSize: 13 }}>{error}</div>}
      {!loading && !error && preview.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {t('segments.detail.pullApi.empty', { defaultValue: 'No members materialized yet — refresh the segment first.' })}
        </div>
      )}
      {preview.length > 0 && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
            {preview.map((row, idx) => (
              <span
                key={`${row.uid}-${idx}`}
                style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', padding: '3px 8px', borderRadius: 'var(--radius-sm)' }}
                title={row.uid}
              >
                {typeof row.name === 'string' && row.name ? `${row.name} · ${row.uid}` : row.uid}
              </span>
            ))}
          </div>
          {cursor && (
            <button
              type="button"
              onClick={loadMore}
              style={{ marginTop: 14, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, color: 'var(--brand)', background: 'transparent', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', padding: '7px 14px', cursor: 'pointer' }}
            >
              {t('segments.detail.pullApi.loadMore', { defaultValue: 'Load more' })}
            </button>
          )}
        </>
      )}
    </div>
  );
}
