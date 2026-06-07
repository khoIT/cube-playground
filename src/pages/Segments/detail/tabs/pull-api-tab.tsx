/**
 * Pull API tab — exposes the segment as a versioned, pullable member list a
 * downstream app can read once and store. Replaces the mock CDP "activation"
 * surface. This is the bare member-ID slice: identity values only, no per-member
 * dims/measures projection yet (that needs a flat per-user cube the segment may
 * not be keyed on).
 *
 * Shows: snapshot freshness + counts, a loud truncation warning when the stored
 * list is a capped sample, the copy-able pull endpoint, a live first-page member
 * preview (so the idea is tangible), and a PII/access note.
 */

import { ReactElement, useCallback, useEffect, useState } from 'react';
import { message } from 'antd';
import { Copy, AlertTriangle, KeyRound, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNowStrict } from 'date-fns';
import { segmentsClient, type SegmentMembersPage } from '../../../../api/segments-client';
import type { Segment } from '../../../../types/segment-api';

interface Props {
  segment: Segment;
  /** Resolved identity dimension (from the segment's preset), shown as the join key. */
  identityDim: string | null;
}

const PREVIEW_LIMIT = 25;

function freshness(value: string | null): string {
  if (!value) return 'never';
  try {
    return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
  } catch {
    return '—';
  }
}

export function PullApiTab({ segment, identityDim }: Props): ReactElement {
  const { t } = useTranslation();
  const [page, setPage] = useState<SegmentMembersPage | null>(null);
  const [preview, setPreview] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch the first page on mount / segment change — gives counts + truncation
  // + the initial member preview in one call.
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    segmentsClient
      .members(segment.id, { limit: PREVIEW_LIMIT })
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
  }, [segment.id]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    try {
      const p = await segmentsClient.members(segment.id, { cursor, limit: PREVIEW_LIMIT });
      setPreview((prev) => [...prev, ...p.members]);
      setCursor(p.next_cursor);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to load more');
    }
  }, [cursor, segment.id]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const membersUrl = `${origin}/api/segments/${segment.id}/members?limit=1000`;
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    message.success(t('common.copied', { defaultValue: 'Copied' }));
  };

  const isFresh = segment.status === 'fresh';

  return (
    <section style={{ paddingTop: 0 }}>
      <header style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 3px', color: 'var(--text-primary)' }}>
          {t('segments.detail.pullApi.title', { defaultValue: 'Pull API' })}
        </h2>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13, maxWidth: 560 }}>
          {t('segments.detail.pullApi.description', {
            defaultValue:
              'Expose this segment as a member list a downstream app can pull once and store. No push — they read on their schedule.',
          })}
        </p>
      </header>

      {/* Snapshot status */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-xl)',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 20px',
            borderBottom: '1px solid var(--border-card)',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
            {t('segments.detail.pullApi.snapshot', { defaultValue: 'Current snapshot' })}
          </h3>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              padding: '3px 9px',
              borderRadius: 'var(--radius-full)',
              background: isFresh ? 'var(--success-soft)' : 'var(--warning-soft)',
              color: isFresh ? 'var(--success-ink)' : 'var(--warning-ink)',
            }}
          >
            {(segment.status ?? 'unknown').toUpperCase()}
          </span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 1,
            background: 'var(--border-card)',
          }}
        >
          {[
            { k: t('segments.detail.pullApi.computed', { defaultValue: 'Computed' }), v: freshness(segment.last_refreshed_at) },
            { k: t('segments.detail.pullApi.members', { defaultValue: 'Members' }), v: (page?.total_count ?? segment.uid_count).toLocaleString() },
            { k: t('segments.detail.pullApi.identity', { defaultValue: 'Identity' }), v: identityDim ?? `${segment.cube ?? '—'}.user_id` },
            { k: t('segments.detail.pullApi.scope', { defaultValue: 'Scope' }), v: segment.game_id },
          ].map((cell) => (
            <div key={cell.k} style={{ background: 'var(--bg-card)', padding: '14px 16px' }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  marginBottom: 6,
                }}
              >
                {cell.k}
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  fontFamily: cell.k.toString().includes('dentity') ? 'var(--font-mono)' : 'var(--font-sans)',
                  wordBreak: 'break-all',
                }}
              >
                {cell.v}
              </div>
            </div>
          ))}
        </div>

        {page?.truncated && (
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              margin: '16px 20px 20px',
              padding: '12px 14px',
              background: 'var(--warning-soft)',
              color: 'var(--warning-ink)',
              border: '1px solid #fde68a',
              borderRadius: 'var(--radius-lg)',
              fontSize: 12.5,
              lineHeight: 1.45,
            }}
          >
            <AlertTriangle size={15} aria-hidden style={{ flex: 'none', marginTop: 1 }} />
            <span>
              {t('segments.detail.pullApi.truncated', {
                defaultValue:
                  'Snapshot is truncated — the true cohort is {{total}} members but the stored list is a capped sample. A pull will receive a partial cohort.',
                total: (page?.total_count ?? 0).toLocaleString(),
              })}
            </span>
          </div>
        )}
      </div>

      {/* Pull endpoint */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-xl)',
          padding: '18px 20px',
          marginBottom: 16,
        }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600 }}>
          {t('segments.detail.pullApi.endpoint', { defaultValue: 'Pull endpoint' })}
        </h3>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 7, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 7px',
              borderRadius: 4,
              background: 'var(--success-soft)',
              color: 'var(--success-ink)',
            }}
          >
            GET
          </span>
          <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11.5 }}>
            {t('segments.detail.pullApi.endpointHint', {
              defaultValue: 'keyset-paginated — follow next_cursor until null',
            })}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--neutral-900)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 12px',
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            color: '#e5e5e5',
            overflow: 'auto',
          }}
        >
          <code style={{ whiteSpace: 'nowrap' }}>{membersUrl}</code>
          <button
            type="button"
            onClick={() => copy(membersUrl)}
            style={{
              marginLeft: 'auto',
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: '#fff',
              fontSize: 10.5,
              padding: '4px 9px',
              borderRadius: 5,
              cursor: 'pointer',
              flex: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <Copy size={11} aria-hidden /> {t('common.copy', { defaultValue: 'Copy' })}
          </button>
        </div>
      </div>

      {/* Live member preview */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-xl)',
          padding: '18px 20px',
          marginBottom: 16,
        }}
      >
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
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
              }}
            >
              {preview.map((uid) => (
                <span
                  key={uid}
                  style={{
                    background: 'var(--bg-muted)',
                    color: 'var(--text-secondary)',
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  {uid}
                </span>
              ))}
            </div>
            {cursor && (
              <button
                type="button"
                onClick={loadMore}
                style={{
                  marginTop: 14,
                  fontFamily: 'inherit',
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: 'var(--brand)',
                  background: 'transparent',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-md)',
                  padding: '7px 14px',
                  cursor: 'pointer',
                }}
              >
                {t('segments.detail.pullApi.loadMore', { defaultValue: 'Load more' })}
              </button>
            )}
          </>
        )}
      </div>

      {/* PII / access note */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          background: 'var(--info-soft)',
          border: '1px solid #bfdbfe',
          borderRadius: 'var(--radius-lg)',
          padding: '13px 16px',
          fontSize: 12.5,
          lineHeight: 1.5,
          color: 'var(--info-ink)',
        }}
      >
        <Shield size={15} aria-hidden style={{ flex: 'none', marginTop: 1 }} />
        <span>
          {t('segments.detail.pullApi.piiNote', {
            defaultValue:
              'Pulling raw member IDs is a PII surface. Access follows this segment’s visibility — anyone who can view the segment can pull it.',
          })}
        </span>
      </div>
    </section>
  );
}
