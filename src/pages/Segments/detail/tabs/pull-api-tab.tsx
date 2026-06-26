/**
 * Pull API tab — exposes the segment as a versioned, pullable member list a
 * downstream app can read once and store. Replaces the mock CDP "activation"
 * surface. The endpoint is TOKENLESS (segment UUID is the capability,
 * deployment is VPN-only) and serves enriched rows when a refresh has built
 * the ranked profile snapshot: uid + in-game name + LTV + lifecycle dates,
 * ordered by the segment's rank measure.
 *
 * Shows: snapshot freshness + counts, the documented public-API integration
 * (segment id + full-cohort endpoint + docs links), warehouse-pull alternatives
 * (Trino SQL / authenticated recipes), a live member preview, and a PII note.
 */

import { ReactElement, useCallback, useEffect, useState } from 'react';
import { message } from 'antd';
import { Copy, KeyRound, Shield, Terminal, Lock, BookOpen, ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNowStrict } from 'date-fns';
import { CollapseChevron } from '../../../Admin/hub/collapse-chevron';
import { PaginatedPullCard } from './paginated-pull-card';
import { describePredicate } from '../../slice-scope/describe-predicate';
import { parseCubeSegmentsFromQueryJson } from '../../slice-scope/parse-cube-segments';
import {
  segmentsClient,
  type SegmentMemberRow,
  type SegmentMembersPage,
  type SegmentPullCredentials,
} from '../../../../api/segments-client';
import type { Segment } from '../../../../types/segment-api';

interface Props {
  segment: Segment;
  /** Resolved identity dimension (from the segment's preset). Retained on the
   *  contract for callers; the snapshot card no longer surfaces it. */
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

export function PullApiTab({ segment }: Props): ReactElement {
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
  // Documented downstream surface. The canonical base is the prod host (the
  // OpenAPI `servers` value + what the consumer guide uses); /docs is linked
  // same-origin so it resolves in prod AND in dev via the vite proxy.
  const publicApiBase = 'https://playground.gds.vng.vn';
  const publicMembersUrl = `${publicApiBase}/api/public/v1/segments/${segment.id}/members`;
  const docsUrl = `${origin}/docs`;
  // Swagger UI is served at the nested prefix; the TRAILING SLASH is required —
  // without it the plugin emits asset URLs that 404 and the page renders blank.
  const swaggerDocsUrl = `${origin}/docs/swagger/`;
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    message.success(t('common.copied', { defaultValue: 'Copied' }));
  };

  const isFresh = segment.status === 'fresh';
  // Trino SQL reproduces membership from the segment's predicate — only live
  // (predicate) segments have a generating query; manual lists are frozen.
  const canGenerateSql = segment.type === 'predicate';

  // The cohort definition, in plain language — so a puller knows WHAT they're
  // pulling. Cube-level segments (named SQL slices) lead, then predicate chips.
  const cubeSegmentChips = parseCubeSegmentsFromQueryJson(segment.cube_query_json).map((s) => {
    const dot = s.indexOf('.');
    return `segment: ${dot >= 0 ? s.slice(dot + 1) : s}`;
  });
  const filterChips = [...cubeSegmentChips, ...describePredicate(segment.predicate_tree)];

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

      {/* Compact snapshot strip — status + key counts + filters in one slim bar
          (replaces the taller card; reads at a glance, frees vertical space). */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-xl)',
          padding: '12px 18px',
          marginBottom: 16,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.04em',
            padding: '3px 9px',
            borderRadius: 'var(--radius-full)',
            background: isFresh ? 'var(--success-soft)' : 'var(--warning-soft)',
            color: isFresh ? 'var(--success-ink)' : 'var(--warning-ink)',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} aria-hidden />
          {(segment.status ?? 'unknown').toUpperCase()}
        </span>

        {/* Members — the headline number. */}
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
          <b style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
            {(page?.total_count ?? segment.uid_count).toLocaleString()}
          </b>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('segments.detail.pullApi.members', { defaultValue: 'members' })}
          </span>
        </span>

        <span style={{ width: 1, height: 22, background: 'var(--border-card)' }} aria-hidden />
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('segments.detail.pullApi.scope', { defaultValue: 'game' })}
          </span>
          <b style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{segment.game_id}</b>
        </span>

        <span style={{ width: 1, height: 22, background: 'var(--border-card)' }} aria-hidden />
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('segments.detail.pullApi.computed', { defaultValue: 'computed' })}
          </span>
          <b style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{freshness(segment.last_refreshed_at)}</b>
        </span>

        {/* Filters — the cohort definition in plain language, pushed right. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            {t('segments.detail.pullApi.filters', { defaultValue: 'Filters' })}
          </span>
          {filterChips.length > 0 ? (
            filterChips.map((chip, i) => (
              <span
                key={`${chip}-${i}`}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-muted)',
                  border: '1px solid var(--border-card)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '3px 9px',
                }}
              >
                {chip}
              </span>
            ))
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {segment.type === 'manual'
                ? t('segments.detail.pullApi.filtersManual', { defaultValue: 'manual list — no live filter' })
                : t('segments.detail.pullApi.filtersNone', { defaultValue: 'none — full game population' })}
            </span>
          )}
        </div>
      </div>

      {/* Downstream API integration — the PRIMARY path, visually elevated above
          the neutral cards: brand border + brand-tint fill + brand shadow mark
          it as the recommended way to build against THIS segment. Hands a
          downstream team the segment id + endpoint + one click into the docs. */}
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
            {/* Secondary renderer — same spec, the classic "Authorize + Try it"
                flow. Trailing slash is required (see swaggerDocsUrl). */}
            <a
              href={swaggerDocsUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--brand)',
                textDecoration: 'none',
              }}
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

        {/* Segment id — the capability a downstream app pulls against. */}
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

      {/* Paginated JSON pull — discrete page_id pages, complements the stream. */}
      <PaginatedPullCard membersUrl={publicMembersUrl} onCopy={copy} />

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
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 7 }}>
              <Terminal size={13} aria-hidden /> {t('segments.detail.pullApi.trinoSql', { defaultValue: 'Trino SQL' })}
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11.5 }}>
                · {t('segments.detail.pullApi.trinoSqlCaption', { defaultValue: 'run the cohort directly against the warehouse' })}
              </span>
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
                'An alternative way to pull the cohort: run it directly against Trino instead of streaming from the API above. Reproduces membership from the segment predicate; params inlined, full cohort (no row cap).',
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

      {/* Authenticated full-cohort pull — an alternative to the public streaming
          API: admin-only credentials + runnable recipes that read the FULL
          cohort straight from the warehouse (raw SQL / Trino / daily snapshot).
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
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <Lock size={13} aria-hidden /> {t('segments.detail.pullApi.fullPull', { defaultValue: 'Full-cohort pull (authenticated)' })}
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 11.5 }}>
              · {t('segments.detail.pullApi.fullPullCaption', { defaultValue: 'service-account recipes' })}
            </span>
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
              'An alternative to the public API: a service account reads the full cohort straight from the warehouse. Reveal credentials below to get a ready-to-run recipe (raw SQL / Trino / daily snapshot).',
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
              'Pulling member IDs and profiles is a PII surface. The public API is secured with a service API key — mint and share keys only with teams who may see this cohort, and revoke them when an integration is retired.',
          })}
        </span>
      </div>
    </section>
  );
}
