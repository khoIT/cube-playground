/**
 * The primary "Build a downstream integration" card — the recommended path,
 * brand-elevated above the neutral cards. Hands a downstream team the segment id,
 * the full-cohort public endpoint, and one click into the API docs / Swagger UI.
 * Pure presentational; copy + urls come from the Build view.
 */

import { ReactElement } from 'react';
import { Copy, BookOpen, ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function IntegrationCard({
  segmentId,
  membersUrl,
  docsUrl,
  swaggerUrl,
  onCopy,
}: {
  segmentId: string;
  membersUrl: string;
  docsUrl: string;
  swaggerUrl: string;
  onCopy: (text: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div
      style={{
        background: 'var(--brand-soft)',
        border: '1.5px solid var(--brand)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: '0 6px 20px rgba(240,90,34,0.16), 0 2px 6px rgba(240,90,34,0.10)',
        padding: '20px 22px',
        marginBottom: 18,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 'var(--radius-md)',
              background: 'var(--brand)',
              color: 'var(--text-on-brand)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <BookOpen size={16} aria-hidden />
          </span>
          <div>
            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--brand)', marginBottom: 2 }}>
              {t('segments.detail.pullApi.publicApiEyebrow', { defaultValue: 'Public API' })}
            </span>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              {t('segments.detail.pullApi.integrate', { defaultValue: 'Build a downstream integration' })}
            </h3>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 'none' }}>
          <a
            href={swaggerUrl}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 600, color: 'var(--brand)', textDecoration: 'none' }}
          >
            {t('segments.detail.pullApi.openSwagger', { defaultValue: 'Swagger UI' })}
            <ArrowUpRight size={12} aria-hidden />
          </a>
          <a
            href={docsUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--text-on-brand)',
              background: 'var(--brand)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              padding: '8px 15px',
              boxShadow: 'var(--shadow-sm)',
              textDecoration: 'none',
            }}
          >
            {t('segments.detail.pullApi.openDocs', { defaultValue: 'Open API docs' })}
            <ArrowUpRight size={13} aria-hidden />
          </a>
        </div>
      </div>
      <p style={{ margin: '11px 0 16px', color: 'var(--text-secondary)', fontSize: 12.5, maxWidth: 600, lineHeight: 1.5 }}>
        {t('segments.detail.pullApi.integrateHint', {
          defaultValue:
            'The versioned, API-key-secured public endpoint streams the FULL cohort (NDJSON/CSV, resumable). The interactive docs show auth, the completion contract, and copy-paste consumer code. Use this segment id below.',
        })}
      </p>

      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
        {t('segments.detail.pullApi.segmentId', { defaultValue: 'Segment ID' })}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-md)',
          padding: '8px 12px',
          fontFamily: 'var(--font-mono)',
          fontSize: 11.5,
          color: 'var(--text-secondary)',
          marginBottom: 12,
        }}
      >
        <code style={{ wordBreak: 'break-all' }}>{segmentId}</code>
        <button
          type="button"
          onClick={() => onCopy(segmentId)}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--brand)',
            background: 'transparent',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            padding: '3px 9px',
            cursor: 'pointer',
            flex: 'none',
          }}
        >
          <Copy size={10} aria-hidden /> {t('common.copy', { defaultValue: 'Copy' })}
        </button>
      </div>

      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
        {t('segments.detail.pullApi.publicEndpoint', { defaultValue: 'Full-cohort endpoint' })}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--surface-inverse)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 12px',
          fontFamily: 'var(--font-mono)',
          fontSize: 11.5,
          color: 'var(--text-on-brand)',
          overflow: 'auto',
        }}
      >
        <code style={{ whiteSpace: 'nowrap' }}>{membersUrl}</code>
        <button
          type="button"
          onClick={() => onCopy(membersUrl)}
          style={{
            marginLeft: 'auto',
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            color: 'var(--text-on-brand)',
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
  );
}
