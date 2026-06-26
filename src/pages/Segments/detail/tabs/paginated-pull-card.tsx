/**
 * Paginated JSON pull recipe — the discrete page-through-the-cohort flow that
 * complements the full-cohort stream. Page 1 (no page_id) pins a point-in-time
 * snapshot and returns up to `limit` uids + an opaque `page_id`; the consumer
 * passes that token back to fetch the next page until `has_more` is false.
 *
 * Pure presentational card: styled with design tokens to sit alongside the other
 * Pull API recipe cards (matches the Public API endpoint card's surfaces).
 */

import { ReactElement } from 'react';
import { Copy, Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  /** Full public members URL for this segment (prod base). */
  membersUrl: string;
  onCopy: (text: string) => void;
}

export function PaginatedPullCard({ membersUrl, onCopy }: Props): ReactElement {
  const { t } = useTranslation();

  const page1 =
    `# Page 1 — pins a point-in-time snapshot, returns up to 1000 uids + a page_id\n` +
    `curl -s -H "Authorization: Bearer sk_live_…" \\\n` +
    `  "${membersUrl}?format=json&limit=1000"\n` +
    `# → { "members": ["…"], "page_id": "eyJ2Ijox…", "has_more": true, "total_count": 1240000 }`;

  const pageN =
    `# Next pages — pass page_id back; repeat until has_more=false (page_id=null)\n` +
    `curl -s -H "Authorization: Bearer sk_live_…" \\\n` +
    `  "${membersUrl}?format=json&page_id=eyJ2Ijox…"`;

  const recipe = `${page1}\n\n${pageN}`;

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 'var(--radius-xl)',
        padding: '18px 20px',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Layers size={15} aria-hidden style={{ color: 'var(--brand)' }} />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
          {t('segments.detail.pullApi.paginatedTitle', { defaultValue: 'Paginated JSON pull' })}
        </h3>
      </div>
      <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: 12.5, maxWidth: 620, lineHeight: 1.5 }}>
        {t('segments.detail.pullApi.paginatedHint', {
          defaultValue:
            'Pull the whole cohort one page at a time, at your own pace. The stream above returns everything at once; this returns discrete JSON pages you can resume. Page 1 pins the snapshot so every page belongs to the same point-in-time cohort.',
        })}
      </p>
      <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: 12, maxWidth: 620, lineHeight: 1.5 }}>
        {t('segments.detail.pullApi.paginatedCsvNote', {
          defaultValue:
            'Prefer CSV? Use format=csv_paged — same paging, but each page is a CSV body with the next token in the X-Next-Page-Id response header (header row on page 1 only, so pages concatenate into one file).',
        })}
      </p>

      <div style={{ position: 'relative' }}>
        <pre
          style={{
            margin: 0,
            background: 'var(--surface-inverse)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            lineHeight: 1.6,
            color: 'var(--text-on-brand)',
            overflow: 'auto',
            whiteSpace: 'pre',
          }}
        >
          <code>{recipe}</code>
        </pre>
        <button
          type="button"
          onClick={() => onCopy(recipe)}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            color: 'var(--text-on-brand)',
            fontSize: 10.5,
            padding: '4px 9px',
            borderRadius: 5,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <Copy size={11} aria-hidden /> {t('common.copy', { defaultValue: 'Copy' })}
        </button>
      </div>

      <p
        style={{
          margin: '12px 0 0',
          color: 'var(--warning-ink)',
          background: 'var(--warning-soft)',
          border: '1px solid var(--warning-ink)',
          borderRadius: 'var(--radius-md)',
          padding: '8px 12px',
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {t('segments.detail.pullApi.paginated409', {
          defaultValue:
            'A 409 (no_snapshot) means the segment has not been snapshotted yet — refresh it, then start again from page 1.',
        })}
      </p>
    </div>
  );
}
