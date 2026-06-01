/**
 * ComparePane — right-pane Compare tab.
 *
 * Top: segmented mode toggle (Off / Prev period / Other game + vs-game picker).
 * Body: per-measure grouped-bar comparison (current vs comparison series) built
 * from `compareState.mergedRows`, with an aggregate Δ% and an N/A note for any
 * measures the comparison game's schema lacks.
 *
 * Reads compare state + setter from CompareContext; reads the active query from
 * QueryBuilderContext to derive row labels. No network work happens here — the
 * merge/load lives in useCompareResults (driven by QueryBuilderInternals).
 */

import { useMemo } from 'react';
import styled from 'styled-components';
import type { Query } from '@cubejs-client/core';

import { useQueryBuilderContext } from '../context';
import { useGameContext } from '../../components/Header/use-game-context';
import { useCompareContext } from './compare-context';
import { CompareToggle } from './compare-toggle';
import type { MergedRow } from './merge-by-dim-key';

// ---------------------------------------------------------------------------
// Styled
// ---------------------------------------------------------------------------

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
`;

const SectionLabel = styled.div`
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-tertiary, var(--text-muted));
  margin-bottom: 10px;
`;

const CmpRow = styled.div`
  display: grid;
  grid-template-columns: 116px 1fr;
  gap: 12px;
  align-items: center;
  margin-bottom: 14px;
`;

const CmpLabel = styled.div`
  min-width: 0;
`;

const CmpMain = styled.div`
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const CmpSub = styled.div`
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-tertiary, var(--text-muted));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Bars = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Track = styled.div`
  flex: 1;
  height: 14px;
  border-radius: var(--radius-full, 9999px);
  background: var(--bg-muted);
  overflow: hidden;
`;

const Fill = styled.div<{ $variant: 'a' | 'b'; $pct: number }>`
  height: 100%;
  border-radius: var(--radius-full, 9999px);
  width: ${(p) => p.$pct}%;
  background: ${(p) => (p.$variant === 'a' ? 'var(--brand)' : 'var(--chart-2)')};
`;

const Val = styled.span`
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-secondary);
  width: 60px;
  text-align: right;
`;

const Legend = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  margin: 10px 0 4px;
  flex-wrap: wrap;
`;

const Swatch = styled.span<{ $variant: 'a' | 'b' }>`
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: ${(p) => (p.$variant === 'a' ? 'var(--brand)' : 'var(--chart-2)')};
`;

const Delta = styled.span<{ $tone: 'up' | 'down' | 'flat' }>`
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: ${(p) =>
    p.$tone === 'up'
      ? 'var(--positive)'
      : p.$tone === 'down'
        ? 'var(--negative)'
        : 'var(--text-tertiary, var(--text-muted))'};
`;

const Note = styled.div<{ $tone: 'info' | 'warn' }>`
  display: flex;
  gap: 9px;
  padding: 9px 11px;
  border-radius: var(--radius-md);
  font-size: 11.5px;
  line-height: 1.5;
  background: ${(p) => (p.$tone === 'warn' ? 'var(--warning-soft)' : 'var(--info-soft)')};
  color: ${(p) => (p.$tone === 'warn' ? 'var(--warning-ink)' : 'var(--info-ink)')};
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Member name without its cube prefix: `recharge.revenue_vnd` → `revenue_vnd`. */
function shortName(member: string): string {
  const dot = member.indexOf('.');
  return dot === -1 ? member : member.slice(dot + 1);
}

/** Cube prefix of a member: `mf_users.user_count` → `mf_users`. */
function cubeName(member: string): string {
  const dot = member.indexOf('.');
  return dot === -1 ? member : member.slice(0, dot);
}

/** Non-time dimensions vs granularity-suffixed time-dimension keys. */
function splitDimKeys(query: Query): { dims: string[]; timeKeys: string[] } {
  const dims = query?.dimensions ?? [];
  const timeKeys = (query?.timeDimensions ?? [])
    .filter((td) => !!td.granularity)
    .map((td) => `${td.dimension}.${td.granularity}`);
  return { dims, timeKeys };
}

/** Cube returns time-dim values as ISO datetimes; show the date portion only. */
function formatTimeValue(v: unknown): string {
  const s = String(v ?? '');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  return m ? m[1] : s;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Compact number: 1.45B / 514M / 12.9K / 880. */
function compact(n: number | null): string {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return new Intl.NumberFormat('en-US').format(n);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ComparePane() {
  const { query } = useQueryBuilderContext();
  const { games } = useGameContext();
  const { compareSetting, compareState, onCompareChange } = useCompareContext();

  const measures = query?.measures ?? [];
  const { dims, timeKeys } = splitDimKeys(query ?? ({} as Query));
  const { mergedRows, isLoading, error, compLabel, unavailableMeasures } = compareState;

  // Friendly label for the comparison series — prefer the game's display name
  // over the raw id baked into compLabel ("Game: ptg").
  const compareName = useMemo(() => {
    if (compareSetting === 'prev') return 'Prior period';
    if (compareSetting?.startsWith('game:')) {
      const gid = compareSetting.slice(5);
      return games.find((g) => g.id === gid)?.name ?? compLabel ?? gid;
    }
    return compLabel || 'Comparison';
  }, [compareSetting, games, compLabel]);

  return (
    <Root>
      <CompareToggle value={compareSetting} onChange={onCompareChange} />

      {compareSetting == null && (
        <Note $tone="info">
          <span>ℹ</span>
          <span>
            Pick <b>Prev period</b> or <b>Other game</b> to compare the current query side by side.
            Comparison runs on the same query shown on the left.
          </span>
        </Note>
      )}

      {compareSetting != null && error && (
        <Note $tone="warn">
          <span>⚠</span>
          <span>{error}</span>
        </Note>
      )}

      {compareSetting != null && !error && isLoading && (
        <Note $tone="info">
          <span>…</span>
          <span>Comparing against {compareName}…</span>
        </Note>
      )}

      {compareSetting != null &&
        !error &&
        !isLoading &&
        measures.map((measure) => {
          const name = shortName(measure);

          if (unavailableMeasures.includes(measure)) {
            return (
              <div key={measure}>
                <SectionLabel>{name}</SectionLabel>
                <Note $tone="warn">
                  <span>⚠</span>
                  <span>
                    <i>N/A</i> — <b>{cubeName(measure)}</b> isn’t in {compareName}’s schema, so this
                    measure can’t be compared. The rest still compares; nothing crashes.
                  </span>
                </Note>
              </div>
            );
          }

          const rows = mergedRows ?? [];
          let maxVal = 0;
          let sumCur = 0;
          let sumCmp = 0;
          for (const r of rows) {
            const cur = toNum(r[measure]) ?? 0;
            const cmp = toNum(r[`${measure}__cmp` as keyof MergedRow]) ?? 0;
            maxVal = Math.max(maxVal, cur, cmp);
            sumCur += cur;
            sumCmp += cmp;
          }
          // Aggregate Δ% sums across ALL merged rows (rows present on only one
          // side contribute their value to one sum and 0 to the other) — a
          // headline figure, not a per-row matched delta.
          const aggPct = sumCmp !== 0 ? (sumCur - sumCmp) / sumCmp : null;
          const tone: 'up' | 'down' | 'flat' =
            aggPct == null || aggPct === 0 ? 'flat' : aggPct > 0 ? 'up' : 'down';

          return (
            <div key={measure}>
              <SectionLabel>
                {name} · current vs {compareName}
              </SectionLabel>
              {rows.length === 0 && (
                <Note $tone="info">
                  <span>ℹ</span>
                  <span>No overlapping rows to compare for the current query.</span>
                </Note>
              )}
              {rows.map((r) => {
                const main = dims.map((d) => String(r[d] ?? '')).filter(Boolean).join(' · ') || '—';
                const sub = timeKeys.map((k) => formatTimeValue(r[k])).filter(Boolean).join(' · ');
                const cur = toNum(r[measure]);
                const cmp = toNum(r[`${measure}__cmp` as keyof MergedRow]);
                return (
                  <CmpRow key={`${main}|${sub}`}>
                    <CmpLabel title={sub ? `${main} · ${sub}` : main}>
                      <CmpMain>{main}</CmpMain>
                      {sub && <CmpSub>{sub}</CmpSub>}
                    </CmpLabel>
                    <Bars>
                      <Bar>
                        <Track>
                          <Fill $variant="a" $pct={maxVal ? ((cur ?? 0) / maxVal) * 100 : 0} />
                        </Track>
                        <Val>{compact(cur)}</Val>
                      </Bar>
                      <Bar>
                        <Track>
                          <Fill $variant="b" $pct={maxVal ? ((cmp ?? 0) / maxVal) * 100 : 0} />
                        </Track>
                        <Val>{compact(cmp)}</Val>
                      </Bar>
                    </Bars>
                  </CmpRow>
                );
              })}
              {rows.length > 0 && (
                <Legend>
                  <Swatch $variant="a" /> Current
                  <Swatch $variant="b" /> {compareName}
                  {aggPct != null && (
                    <Delta $tone={tone}>
                      {tone === 'down' ? '▼' : tone === 'up' ? '▲' : '—'}{' '}
                      {Math.abs(aggPct * 100).toFixed(1)}%
                    </Delta>
                  )}
                </Legend>
              )}
            </div>
          );
        })}
    </Root>
  );
}
