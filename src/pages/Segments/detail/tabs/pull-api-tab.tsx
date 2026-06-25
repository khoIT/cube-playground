/**
 * Pull API tab — exposes the segment as a versioned, pullable member list a
 * downstream app can read once and store. Replaces the mock CDP "activation"
 * surface. The endpoint is TOKENLESS (segment UUID is the capability,
 * deployment is VPN-only) and serves enriched rows when a refresh has built
 * the ranked profile snapshot: uid + in-game name + LTV + lifecycle dates,
 * ordered by the segment's rank measure.
 *
 * Shows: snapshot freshness + counts, a loud truncation warning when the stored
 * list is a capped sample, the copy-able pull endpoint, a live first-page member
 * preview (so the idea is tangible), and a PII/access note.
 */

import { ReactElement, useCallback, useEffect, useState } from 'react';
import { message } from 'antd';
import { Copy, AlertTriangle, KeyRound, Shield, Terminal, Lock, BookOpen, ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNowStrict } from 'date-fns';
import { CollapseChevron } from '../../../Admin/hub/collapse-chevron';
import {
  segmentsClient,
  type SegmentMemberRow,
  type SegmentMembersPage,
  type SegmentPullCredentials,
} from '../../../../api/segments-client';
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
  const [preview, setPreview] = useState<SegmentMemberRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The Trino SQL and Full-cohort pull cards are advanced/secondary surfaces —
  // collapsed by default so the tab leads with the snapshot + the documented
  // downstream API path, and the heavier recipes are one click away.
  const [sqlOpen, setSqlOpen] = useState(false);
  const [credsOpen, setCredsOpen] = useState(false);

  // Trino SQL is generated on demand — it triggers a Cube /sql compile that can
  // be slow on a cold warehouse, so we don't fetch it until the user asks.
  const [trinoSql, setTrinoSql] = useState<{
    loading: boolean;
    sql: string | null;
    catalog?: string;
    schema?: string | null;
    error: string | null;
  }>({ loading: false, sql: null, error: null });

  // Authenticated full-cohort pull credentials — admin only, fetched on demand
  // (mints a token + reveals the warehouse connection, so never auto-loaded).
  const [creds, setCreds] = useState<{
    loading: boolean;
    data: SegmentPullCredentials | null;
    error: string | null;
  }>({ loading: false, data: null, error: null });

  const revealCredentials = useCallback(async () => {
    setCreds({ loading: true, data: null, error: null });
    try {
      const data = await segmentsClient.pullCredentials(segment.id);
      setCreds({ loading: false, data, error: null });
    } catch (e) {
      setCreds({
        loading: false,
        data: null,
        error: e instanceof Error ? e.message : 'Failed to load credentials',
      });
    }
  }, [segment.id]);

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

  const generateTrinoSql = useCallback(async () => {
    setTrinoSql({ loading: true, sql: null, error: null });
    try {
      const r = await segmentsClient.membershipSql(segment.id);
      setTrinoSql({ loading: false, sql: r.sql, catalog: r.catalog, schema: r.schema, error: null });
    } catch (e) {
      setTrinoSql({
        loading: false,
        sql: null,
        error: e instanceof Error ? e.message : 'Failed to generate SQL',
      });
    }
  }, [segment.id]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const membersUrl = `${origin}/api/segments/${segment.id}/members?limit=1000`;
  // Documented downstream surface. The canonical base is the prod host (the
  // OpenAPI `servers` value + what the consumer guide uses); /docs is linked
  // same-origin so it resolves in prod AND in dev via the vite proxy.
  const publicApiBase = 'https://playground.gds.vng.vn';
  const publicMembersUrl = `${publicApiBase}/api/public/v1/segments/${segment.id}/members`;
  const docsUrl = `${origin}/docs`;
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    message.success(t('common.copied', { defaultValue: 'Copied' }));
  };

  const isFresh = segment.status === 'fresh';
  // Trino SQL reproduces membership from the segment's predicate — only live
  // (predicate) segments have a generating query; manual lists are frozen.
  const canGenerateSql = segment.type === 'predicate';

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
              border: '1px solid var(--warning-border)',
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
              defaultValue: 'tokenless · ranked by the segment metric — follow next_cursor until null',
            })}
          </span>
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
            onClick={() => copy(membersUrl)}
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

      {/* Downstream API integration — the documented, versioned public surface.
          The seamless path: this card hands a downstream tech team the segment
          id + the exact endpoint and one click into the interactive API docs to
          build a real integration against THIS segment. */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-xl)',
          padding: '18px 20px',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
            <BookOpen size={13} aria-hidden />{' '}
            {t('segments.detail.pullApi.integrate', { defaultValue: 'Build a downstream integration' })}
          </h3>
          <a
            href={docsUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--text-on-brand)',
              background: 'var(--brand)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              padding: '7px 14px',
              textDecoration: 'none',
            }}
          >
            {t('segments.detail.pullApi.openDocs', { defaultValue: 'Open API docs' })}
            <ArrowUpRight size={13} aria-hidden />
          </a>
        </div>
        <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: 12, maxWidth: 560 }}>
          {t('segments.detail.pullApi.integrateHint', {
            defaultValue:
              'The versioned, API-key-secured public endpoint streams the FULL cohort (NDJSON/CSV, resumable). The interactive docs show auth, the completion contract, and copy-paste consumer code. Use this segment id below.',
          })}
        </p>

        {/* Segment id — the capability a downstream app pulls against. */}
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
          {t('segments.detail.pullApi.segmentId', { defaultValue: 'Segment ID' })}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--bg-muted)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            color: 'var(--text-secondary)',
            marginBottom: 12,
          }}
        >
          <code style={{ wordBreak: 'break-all' }}>{segment.id}</code>
          <button
            type="button"
            onClick={() => copy(segment.id)}
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

        {/* The public streaming endpoint for this segment. */}
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
          <code style={{ whiteSpace: 'nowrap' }}>{publicMembersUrl}</code>
          <button
            type="button"
            onClick={() => copy(publicMembersUrl)}
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

      {/* Trino SQL — run the membership query directly against the warehouse.
          Collapsed by default (advanced path). */}
      {canGenerateSql && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-xl)',
            padding: '18px 20px',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: sqlOpen ? 4 : 0 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
              <Terminal size={13} aria-hidden /> {t('segments.detail.pullApi.trinoSql', { defaultValue: 'Trino SQL' })}
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {sqlOpen && trinoSql.sql && (
              <button
                type="button"
                onClick={() => copy(trinoSql.sql ?? '')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: 'var(--brand)',
                  background: 'transparent',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-md)',
                  padding: '5px 11px',
                  cursor: 'pointer',
                }}
              >
                <Copy size={11} aria-hidden /> {t('common.copy', { defaultValue: 'Copy' })}
              </button>
            )}
              <CollapseChevron
                open={sqlOpen}
                onToggle={() => setSqlOpen((o) => !o)}
                label={t('segments.detail.pullApi.toggleSql', { defaultValue: 'Toggle Trino SQL' })}
              />
            </div>
          </div>
          {sqlOpen && (
          <>
          <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: 12, maxWidth: 560 }}>
            {t('segments.detail.pullApi.trinoSqlHint', {
              defaultValue:
                'Run this cohort directly against Trino instead of pulling. Reproduces membership from the segment predicate; params inlined, full cohort (no row cap).',
            })}
          </p>

          {!trinoSql.sql && !trinoSql.error && (
            <button
              type="button"
              onClick={generateTrinoSql}
              disabled={trinoSql.loading}
              style={{
                fontFamily: 'inherit',
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--text-on-brand)',
                background: 'var(--brand)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                padding: '8px 16px',
                cursor: trinoSql.loading ? 'default' : 'pointer',
                opacity: trinoSql.loading ? 0.7 : 1,
              }}
            >
              {trinoSql.loading
                ? t('common.loading', { defaultValue: 'Loading…' })
                : t('segments.detail.pullApi.generateSql', { defaultValue: 'Generate SQL' })}
            </button>
          )}

          {trinoSql.error && (
            <div style={{ color: 'var(--destructive-ink)', fontSize: 12.5, marginBottom: 10 }}>
              {trinoSql.error}{' '}
              <button
                type="button"
                onClick={generateTrinoSql}
                style={{ background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: 0 }}
              >
                {t('common.retry', { defaultValue: 'Retry' })}
              </button>
            </div>
          )}

          {trinoSql.sql && (
            <>
              {trinoSql.schema && (
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8 }}>
                  {t('segments.detail.pullApi.trinoSqlSchema', {
                    defaultValue:
                      'Tables are referenced unqualified — set catalog {{catalog}}, schema {{schema}} in your Trino session.',
                    catalog: trinoSql.catalog ?? 'game_integration',
                    schema: trinoSql.schema,
                  })}
                </div>
              )}
              <pre
                style={{
                  margin: 0,
                  background: 'var(--surface-inverse)',
                  color: 'var(--text-on-brand)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 14px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  lineHeight: 1.5,
                  maxHeight: 320,
                  overflow: 'auto',
                  whiteSpace: 'pre',
                }}
              >
                <code>{trinoSql.sql}</code>
              </pre>
            </>
          )}
          </>
          )}
        </div>
      )}

      {/* Authenticated full-cohort pull — admin-only credentials + runnable
          recipes for the FULL cohort (the tokenless endpoint above is capped).
          Collapsed by default (reveals the warehouse connection on expand). */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-xl)',
          padding: '18px 20px',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: credsOpen ? 4 : 0 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Lock size={13} aria-hidden /> {t('segments.detail.pullApi.fullPull', { defaultValue: 'Full-cohort pull (authenticated)' })}
          </h3>
          <CollapseChevron
            open={credsOpen}
            onToggle={() => setCredsOpen((o) => !o)}
            label={t('segments.detail.pullApi.toggleFullPull', { defaultValue: 'Toggle full-cohort pull' })}
          />
        </div>
        {credsOpen && (
        <>
        <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: 12, maxWidth: 560 }}>
          {t('segments.detail.pullApi.fullPullHint', {
            defaultValue:
              'The endpoint above is a capped ranked sample. To pull the full cohort, a service account runs the membership query against Trino. Reveal credentials below to get a ready-to-run recipe.',
          })}
        </p>

        {!creds.data && (
          <button
            type="button"
            onClick={revealCredentials}
            disabled={creds.loading}
            style={{
              fontFamily: 'inherit',
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--text-on-brand)',
              background: 'var(--brand)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              padding: '8px 16px',
              cursor: creds.loading ? 'default' : 'pointer',
              opacity: creds.loading ? 0.7 : 1,
            }}
          >
            {creds.loading
              ? t('common.loading', { defaultValue: 'Loading…' })
              : t('segments.detail.pullApi.revealCreds', { defaultValue: 'Reveal pull credentials (admin)' })}
          </button>
        )}

        {creds.error && (
          <div style={{ color: 'var(--destructive-ink)', fontSize: 12.5 }}>
            {creds.error}{' '}
            <button
              type="button"
              onClick={revealCredentials}
              style={{ background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: 0 }}
            >
              {t('common.retry', { defaultValue: 'Retry' })}
            </button>
          </div>
        )}

        {creds.data &&
          (() => {
            const d = creds.data;
            const ws = d.workspace ?? 'prod';
            const sqlUrl = `${origin}/api/segments/${segment.id}/membership-sql`;
            // Recipe 1: pull the runnable SELECT through our guarded API (token inlined).
            const apiRecipe =
              `# 1) fetch the runnable SELECT (full cohort, row cap stripped)\n` +
              `curl -s "${sqlUrl}" \\\n` +
              `  -H "Authorization: Bearer ${d.appJwt}" \\\n` +
              `  -H "x-cube-workspace: ${ws}" | jq -r .sql > cohort.sql`;
            // Recipe 2: run it directly in Trino (coords prepopulated; password from env).
            const trinoRecipe = d.trino
              ? `# 2) run it against Trino — TRINO_PASS from your own env, not shown here\n` +
                `trino --server ${d.trino.ssl ? 'https' : 'http'}://${d.trino.host}:${d.trino.port} \\\n` +
                `  --user ${d.trino.user} --password \\\n` +
                `  --catalog ${d.trino.catalog} --schema ${d.trino.schema ?? '<game-schema>'} \\\n` +
                `  -f cohort.sql`
              : '# Trino coordinates are not configured on this instance (CUBEJS_DB_* unset).';
            // Recipe 3: prod's gentlest path — read the pre-materialized daily table.
            const lakehouseRecipe =
              `SELECT uid FROM ${d.lakehouse.catalog}."${d.lakehouse.schema}".${d.lakehouse.table}\n` +
              `WHERE snapshot_date = current_date AND segment_id = '${segment.id}'\n` +
              `ORDER BY uid;`;
            const block = (label: string, body: string) => (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
                  <button
                    type="button"
                    onClick={() => copy(body)}
                    style={{
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
                    }}
                  >
                    <Copy size={10} aria-hidden /> {t('common.copy', { defaultValue: 'Copy' })}
                  </button>
                </div>
                <pre
                  style={{
                    margin: 0,
                    background: 'var(--surface-inverse)',
                    color: 'var(--text-on-brand)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 14px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    lineHeight: 1.55,
                    maxHeight: 240,
                    overflow: 'auto',
                    whiteSpace: 'pre',
                  }}
                >
                  <code>{body}</code>
                </pre>
              </div>
            );
            return (
              <>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 4 }}>
                  {t('segments.detail.pullApi.credsMinted', {
                    defaultValue:
                      'Minted for {{email}} ({{role}}) · expires in {{mins}} min · workspace {{ws}}',
                    email: d.user.email ?? '—',
                    role: d.user.role,
                    mins: d.expiresInMinutes,
                    ws,
                  })}
                </div>
                {block(
                  t('segments.detail.pullApi.recipeApi', { defaultValue: 'Via our API — fetch the SELECT' }),
                  apiRecipe,
                )}
                {block(
                  t('segments.detail.pullApi.recipeTrino', { defaultValue: 'Then run it directly in Trino' }),
                  trinoRecipe,
                )}
                {block(
                  t('segments.detail.pullApi.recipeLakehouse', {
                    defaultValue: 'Prod — read the daily snapshot table (gentlest)',
                  }),
                  lakehouseRecipe,
                )}
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
              {preview.map((row, idx) => (
                <span
                  key={`${row.uid}-${idx}`}
                  style={{
                    background: 'var(--bg-muted)',
                    color: 'var(--text-secondary)',
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-sm)',
                  }}
                  title={row.uid}
                >
                  {/* Enriched rows lead with the friendly name when the game models one. */}
                  {typeof row.name === 'string' && row.name ? `${row.name} · ${row.uid}` : row.uid}
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
              'Pulling member IDs and profiles is a PII surface. The pull endpoint is tokenless — the segment URL itself is the credential, so share it only with teams who may see this cohort.',
          })}
        </span>
      </div>
    </section>
  );
}
