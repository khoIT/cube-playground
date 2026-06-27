/**
 * "Build the integration" job of the Pull API tab — everything a downstream
 * developer needs to pull this segment's cohort, composed from focused cards:
 * the brand integration card (id + endpoint + docs), the paginated JSON recipe,
 * two collapsed advanced paths (Trino SQL / authenticated recipes), a live member
 * preview, and a PII note. Lifecycle/contract status lives in the header above —
 * this view is purely "how to pull it".
 */

import { ReactElement } from 'react';
import { message } from 'antd';
import { Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PaginatedPullCard } from '../paginated-pull-card';
import type { Segment } from '../../../../../types/segment-api';
import { IntegrationCard } from './integration-card';
import { TrinoSqlCard } from './trino-sql-card';
import { AuthRecipesCard } from './auth-recipes-card';
import { MemberPreviewCard } from './member-preview-card';

export function BuildModeView({ segment }: { segment: Segment }): ReactElement {
  const { t } = useTranslation();

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // Canonical base is the prod host (OpenAPI `servers` + the consumer guide);
  // /docs is linked same-origin so it resolves in prod AND dev (vite proxy).
  const publicMembersUrl = `https://playground.gds.vng.vn/api/public/v1/segments/${segment.id}/members`;
  const docsUrl = `${origin}/docs`;
  // Swagger UI's trailing slash is required — without it the plugin emits asset
  // URLs that 404 and the page renders blank.
  const swaggerUrl = `${origin}/docs/swagger/`;

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    message.success(t('common.copied', { defaultValue: 'Copied' }));
  };

  // Trino SQL reproduces membership from the predicate — only live (predicate)
  // segments have a generating query; manual lists are frozen.
  const canGenerateSql = segment.type === 'predicate';

  return (
    <>
      <IntegrationCard segmentId={segment.id} membersUrl={publicMembersUrl} docsUrl={docsUrl} swaggerUrl={swaggerUrl} onCopy={copy} />

      {/* Paginated JSON pull — discrete page_id pages, complements the stream. */}
      <PaginatedPullCard membersUrl={publicMembersUrl} onCopy={copy} />

      {canGenerateSql && <TrinoSqlCard segmentId={segment.id} onCopy={copy} />}

      <AuthRecipesCard segmentId={segment.id} origin={origin} onCopy={copy} />

      <MemberPreviewCard segmentId={segment.id} />

      {/* PII / access note */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          background: 'var(--info-soft)',
          border: '1px solid var(--info-border)',
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
              'Pulling member IDs and profiles is a PII surface. The public API is secured with a service API key — mint and share keys only with teams who may see this cohort, and revoke them when an integration is retired.',
          })}
        </span>
      </div>
    </>
  );
}
