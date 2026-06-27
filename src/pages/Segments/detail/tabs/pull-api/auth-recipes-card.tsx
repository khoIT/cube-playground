/**
 * Collapsed advanced path: admin-only service-account credentials + ready-to-run
 * recipes that read the FULL cohort straight from the warehouse (our API → Trino
 * → daily snapshot table). Self-contained (owns reveal state); reveals the
 * warehouse connection on expand, so never auto-loaded.
 */

import { ReactElement, useCallback, useState } from 'react';
import { Lock, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CollapseChevron } from '../../../../Admin/hub/collapse-chevron';
import { segmentsClient, type SegmentPullCredentials } from '../../../../../api/segments-client';

export function AuthRecipesCard({
  segmentId,
  origin,
  onCopy,
}: {
  segmentId: string;
  origin: string;
  onCopy: (t: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [creds, setCreds] = useState<{ loading: boolean; data: SegmentPullCredentials | null; error: string | null }>({
    loading: false,
    data: null,
    error: null,
  });

  const reveal = useCallback(async () => {
    setCreds({ loading: true, data: null, error: null });
    try {
      const data = await segmentsClient.pullCredentials(segmentId);
      setCreds({ loading: false, data, error: null });
    } catch (e) {
      setCreds({ loading: false, data: null, error: e instanceof Error ? e.message : 'Failed to load credentials' });
    }
  }, [segmentId]);

  const block = (lbl: string, body: string) => (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>{lbl}</span>
        <button
          type="button"
          onClick={() => onCopy(body)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--brand)', background: 'transparent', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', padding: '3px 9px', cursor: 'pointer' }}
        >
          <Copy size={10} aria-hidden /> {t('common.copy', { defaultValue: 'Copy' })}
        </button>
      </div>
      <pre style={{ margin: 0, background: 'var(--surface-inverse)', color: 'var(--text-on-brand)', borderRadius: 'var(--radius-md)', padding: '12px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.55, maxHeight: 240, overflow: 'auto', whiteSpace: 'pre' }}>
        <code>{body}</code>
      </pre>
    </div>
  );

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-xl)', padding: '18px 20px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: open ? 4 : 0 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Lock size={13} aria-hidden /> {t('segments.detail.pullApi.fullPull', { defaultValue: 'Full-cohort pull (authenticated)' })}
          <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11.5 }}>
            · {t('segments.detail.pullApi.fullPullCaption', { defaultValue: 'service-account recipes' })}
          </span>
        </h3>
        <CollapseChevron open={open} onToggle={() => setOpen((o) => !o)} label={t('segments.detail.pullApi.toggleFullPull', { defaultValue: 'Toggle full-cohort pull' })} />
      </div>
      {open && (
        <>
          <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: 12, maxWidth: 560 }}>
            {t('segments.detail.pullApi.fullPullHint', {
              defaultValue:
                'An alternative to the public API: a service account reads the full cohort straight from the warehouse. Reveal credentials below to get a ready-to-run recipe (raw SQL / Trino / daily snapshot).',
            })}
          </p>
          {!creds.data && (
            <button
              type="button"
              onClick={reveal}
              disabled={creds.loading}
              style={{ fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, color: 'var(--text-on-brand)', background: 'var(--brand)', border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 16px', cursor: creds.loading ? 'default' : 'pointer', opacity: creds.loading ? 0.7 : 1 }}
            >
              {creds.loading ? t('common.loading', { defaultValue: 'Loading…' }) : t('segments.detail.pullApi.revealCreds', { defaultValue: 'Reveal pull credentials (admin)' })}
            </button>
          )}
          {creds.error && (
            <div style={{ color: 'var(--destructive-ink)', fontSize: 12.5 }}>
              {creds.error}{' '}
              <button type="button" onClick={reveal} style={{ background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: 0 }}>
                {t('common.retry', { defaultValue: 'Retry' })}
              </button>
            </div>
          )}
          {creds.data &&
            (() => {
              const d = creds.data;
              const ws = d.workspace ?? 'prod';
              const sqlUrl = `${origin}/api/segments/${segmentId}/membership-sql`;
              const apiRecipe =
                `# 1) fetch the runnable SELECT (full cohort, row cap stripped)\n` +
                `curl -s "${sqlUrl}" \\\n` +
                `  -H "Authorization: Bearer ${d.appJwt}" \\\n` +
                `  -H "x-cube-workspace: ${ws}" | jq -r .sql > cohort.sql`;
              const trinoRecipe = d.trino
                ? `# 2) run it against Trino — TRINO_PASS from your own env, not shown here\n` +
                  `trino --server ${d.trino.ssl ? 'https' : 'http'}://${d.trino.host}:${d.trino.port} \\\n` +
                  `  --user ${d.trino.user} --password \\\n` +
                  `  --catalog ${d.trino.catalog} --schema ${d.trino.schema ?? '<game-schema>'} \\\n` +
                  `  -f cohort.sql`
                : '# Trino coordinates are not configured on this instance (CUBEJS_DB_* unset).';
              const lakehouseRecipe =
                `SELECT uid FROM ${d.lakehouse.catalog}."${d.lakehouse.schema}".${d.lakehouse.table}\n` +
                `WHERE snapshot_date = current_date AND segment_id = '${segmentId}'\n` +
                `ORDER BY uid;`;
              return (
                <>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 4 }}>
                    {t('segments.detail.pullApi.credsMinted', {
                      defaultValue: 'Minted for {{email}} ({{role}}) · expires in {{mins}} min · workspace {{ws}}',
                      email: d.user.email ?? '—',
                      role: d.user.role,
                      mins: d.expiresInMinutes,
                      ws,
                    })}
                  </div>
                  {block(t('segments.detail.pullApi.recipeApi', { defaultValue: 'Via our API — fetch the SELECT' }), apiRecipe)}
                  {block(t('segments.detail.pullApi.recipeTrino', { defaultValue: 'Then run it directly in Trino' }), trinoRecipe)}
                  {block(t('segments.detail.pullApi.recipeLakehouse', { defaultValue: 'Prod — read the daily snapshot table (gentlest)' }), lakehouseRecipe)}
                  {!d.lakehouse.snapshotEnabled && (
                    <div style={{ fontSize: 11.5, color: 'var(--warning-ink)', marginTop: 8 }}>
                      {t('segments.detail.pullApi.snapshotOff', {
                        defaultValue:
                          'This instance is not landing daily partitions (SEGMENT_SNAPSHOT_ENABLED is off) — the snapshot-table recipe is the prod path. Use the Trino recipe above here.',
                      })}
                    </div>
                  )}
                </>
              );
            })()}
        </>
      )}
    </div>
  );
}
