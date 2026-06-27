/**
 * Collapsed advanced path: generate the Trino SQL that reproduces this segment's
 * membership and run it directly against the warehouse. Self-contained (owns its
 * open + fetch state); only live (predicate) segments have a generating query.
 */

import { ReactElement, useCallback, useState } from 'react';
import { Terminal, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CollapseChevron } from '../../../../Admin/hub/collapse-chevron';
import { segmentsClient } from '../../../../../api/segments-client';

export function TrinoSqlCard({ segmentId, onCopy }: { segmentId: string; onCopy: (t: string) => void }): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{
    loading: boolean;
    sql: string | null;
    catalog?: string;
    schema?: string | null;
    error: string | null;
  }>({ loading: false, sql: null, error: null });

  const generate = useCallback(async () => {
    setState({ loading: true, sql: null, error: null });
    try {
      const r = await segmentsClient.membershipSql(segmentId);
      setState({ loading: false, sql: r.sql, catalog: r.catalog, schema: r.schema, error: null });
    } catch (e) {
      setState({ loading: false, sql: null, error: e instanceof Error ? e.message : 'Failed to generate SQL' });
    }
  }, [segmentId]);

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--radius-xl)', padding: '18px 20px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: open ? 4 : 0 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Terminal size={13} aria-hidden /> {t('segments.detail.pullApi.trinoSql', { defaultValue: 'Trino SQL' })}
          <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11.5 }}>
            · {t('segments.detail.pullApi.trinoSqlCaption', { defaultValue: 'run the cohort directly against the warehouse' })}
          </span>
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {open && state.sql && (
            <button
              type="button"
              onClick={() => onCopy(state.sql ?? '')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: 'var(--brand)', background: 'transparent', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-md)', padding: '5px 11px', cursor: 'pointer' }}
            >
              <Copy size={11} aria-hidden /> {t('common.copy', { defaultValue: 'Copy' })}
            </button>
          )}
          <CollapseChevron open={open} onToggle={() => setOpen((o) => !o)} label={t('segments.detail.pullApi.toggleSql', { defaultValue: 'Toggle Trino SQL' })} />
        </div>
      </div>
      {open && (
        <>
          <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: 12, maxWidth: 560 }}>
            {t('segments.detail.pullApi.trinoSqlHint', {
              defaultValue:
                'An alternative way to pull the cohort: run it directly against Trino instead of streaming from the API above. Reproduces membership from the segment predicate; params inlined, full cohort (no row cap).',
            })}
          </p>
          {!state.sql && !state.error && (
            <button
              type="button"
              onClick={generate}
              disabled={state.loading}
              style={{ fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, color: 'var(--text-on-brand)', background: 'var(--brand)', border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 16px', cursor: state.loading ? 'default' : 'pointer', opacity: state.loading ? 0.7 : 1 }}
            >
              {state.loading ? t('common.loading', { defaultValue: 'Loading…' }) : t('segments.detail.pullApi.generateSql', { defaultValue: 'Generate SQL' })}
            </button>
          )}
          {state.error && (
            <div style={{ color: 'var(--destructive-ink)', fontSize: 12.5, marginBottom: 10 }}>
              {state.error}{' '}
              <button type="button" onClick={generate} style={{ background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: 0 }}>
                {t('common.retry', { defaultValue: 'Retry' })}
              </button>
            </div>
          )}
          {state.sql && (
            <>
              {state.schema && (
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8 }}>
                  {t('segments.detail.pullApi.trinoSqlSchema', {
                    defaultValue: 'Tables are referenced unqualified — set catalog {{catalog}}, schema {{schema}} in your Trino session.',
                    catalog: state.catalog ?? 'game_integration',
                    schema: state.schema,
                  })}
                </div>
              )}
              <pre style={{ margin: 0, background: 'var(--surface-inverse)', color: 'var(--text-on-brand)', borderRadius: 'var(--radius-md)', padding: '12px 14px', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.5, maxHeight: 320, overflow: 'auto', whiteSpace: 'pre' }}>
                <code>{state.sql}</code>
              </pre>
            </>
          )}
        </>
      )}
    </div>
  );
}
