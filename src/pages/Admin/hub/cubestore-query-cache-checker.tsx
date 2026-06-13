/**
 * CubestoreQueryCacheChecker — "does this query have cache?" Resolves a Cube
 * query to the rollup(s) it routes to (dry-run) and reports whether those are
 * materialised + serving in CubeStore. Makes passthrough legible: a query can
 * plan a rollup that is registered-but-not-active and silently hit source.
 *
 * Input is a game + a Cube query (JSON), prefilled with the active_daily.dau
 * shape. Tokens only — no inline hex.
 */

import React, { useState } from 'react';
import { useQueryCacheCheck, type CacheVerdict } from './cubestore-data';

const card: React.CSSProperties = {
  border: '1px solid var(--border-card)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-card)',
};
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11.5 };

const EXAMPLE = JSON.stringify(
  {
    measures: ['active_daily.dau'],
    timeDimensions: [{ dimension: 'active_daily.log_date', dateRange: ['2026-05-01', '2026-05-07'], granularity: 'day' }],
  },
  null,
  2,
);

const VERDICT_TONE: Record<CacheVerdict, { bg: string; ink: string; label: string }> = {
  materialized: { bg: 'var(--success-soft)', ink: 'var(--success-ink)', label: 'serving from cache' },
  'registered-not-active': { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)', label: 'registered · not sealed → passthrough' },
  'not-built': { bg: 'var(--destructive-soft)', ink: 'var(--destructive-ink)', label: 'not built' },
};

export function CubestoreQueryCacheChecker({ games }: { games: Array<{ id: string; label: string }> }) {
  const { result, loading, error, run } = useQueryCacheCheck();
  const [game, setGame] = useState(games[0]?.id ?? '');
  const [text, setText] = useState(EXAMPLE);
  const [parseError, setParseError] = useState<string | null>(null);

  const onCheck = () => {
    let query: unknown;
    try {
      query = JSON.parse(text);
    } catch {
      setParseError('Query is not valid JSON.');
      return;
    }
    setParseError(null);
    if (game) void run(game, query);
  };

  return (
    <div style={{ ...card, padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Does this query have cache?</span>
        <select
          value={game}
          onChange={(e) => setGame(e.target.value)}
          style={{ ...mono, padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-card)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
        >
          {games.map((g) => <option key={g.id} value={g.id}>{g.id}</option>)}
        </select>
        <button
          type="button"
          onClick={onCheck}
          disabled={loading || !game}
          style={{
            height: 26, padding: '0 12px', fontSize: 12, fontWeight: 600,
            color: 'var(--brand)', background: 'var(--brand-soft)', border: '1px solid var(--brand)',
            borderRadius: 'var(--radius-sm)', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Checking…' : 'Check'}
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={7}
        style={{ ...mono, width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-card)', background: 'var(--bg-subtle, var(--muted-soft))', color: 'var(--text-primary)', resize: 'vertical' }}
      />

      {parseError && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--destructive-ink)' }}>{parseError}</div>}
      {error && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--destructive-ink)' }}>Check failed: {error}</div>}

      {result && !result.enabled && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>CubeStore introspection is off on this gateway.</div>
      )}
      {result?.error && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--warning-ink)' }}>{result.error}</div>}
      {result?.note && <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>{result.note}</div>}

      {result && result.preaggs.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: result.willServeFromCache ? 'var(--success-ink)' : 'var(--warning-ink)' }}>
            {result.willServeFromCache ? 'Serves from CubeStore cache.' : 'Plans a rollup, but it is not serving — query falls through to source.'}
          </div>
          {result.preaggs.map((p) => {
            const tone = VERDICT_TONE[p.verdict];
            return (
              <div key={p.tableName} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11.5 }}>
                <span style={{ background: tone.bg, color: tone.ink, borderRadius: 'var(--radius-sm)', padding: '1px 7px', fontWeight: 600, whiteSpace: 'nowrap' }}>{tone.label}</span>
                <span style={{ ...mono, color: 'var(--text-primary)' }} title={p.preAggregationId}>{p.tableName}</span>
                <span style={{ color: 'var(--text-muted)' }}>{p.activePartitions} active part · {p.rows ? p.rows.toLocaleString() : 0} rows</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
