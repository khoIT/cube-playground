/**
 * Journey section — milestone timeline (from the profile row) + two recent
 * trend charts: level progression (area line) and daily recharge (bars), each
 * the last ≤31 data points for the member. Activity/recharge daily cubes are
 * not behavior-guarded, but we cap rows to keep the charts tidy.
 */

import { ReactElement, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Query } from '@cubejs-client/core';
import { LineChart } from '../../visuals';
import { MiniBarChart } from './mini-bar-chart';
import { SectionCard } from './dashboard-stats';
import type { Member360Sections } from '../member360-sections';
import { qualify } from '../member360-sections';
import { useMemberCubeQuery } from '../use-member-cube-query';
import type { CachedPanelSource } from '../use-cached-panel-source';
import { formatCell } from '../format-cell';

interface Props {
  gameId: string | null;
  uid: string;
  sections: Member360Sections;
  row: Record<string, unknown> | null;
  /** Nightly precompute source — trend rows derive from the cached daily
   *  timeline panels (which carry the same time/value members, desc-ordered,
   *  limit 90 ≥ the 31 points we chart) instead of two live queries. */
  cachedSource?: CachedPanelSource;
}

const RECENT = 31;
const viewOf = (member: string) => member.split('.', 1)[0];

function trendQuery(timeDim: string, valueMember: string, uid: string): Query {
  return {
    dimensions: [timeDim, valueMember],
    filters: [{ member: `${viewOf(timeDim)}.user_id`, operator: 'equals' as never, values: [uid] }],
    order: { [timeDim]: 'desc' },
    limit: RECENT,
  };
}

/** Cached timeline panel id for a trend's time dimension (view-derived). */
const TIMELINE_PANEL_BY_VIEW: Record<string, string> = {
  user_activity_timeline: 'activity_timeline',
  user_recharge_timeline: 'recharge_timeline',
};

export function DashboardJourney({ gameId, uid, sections, row, cachedSource }: Props): ReactElement {
  const { t } = useTranslation();

  // Cached rows usable for a trend chart: panel fresh AND it carries both
  // members the chart reads (coverage guard against registry drift).
  const cachedTrend = (timeDim: string, valueMember: string): Record<string, unknown>[] | null => {
    const panelId = TIMELINE_PANEL_BY_VIEW[viewOf(timeDim)];
    if (!panelId || !cachedSource) return null;
    const hit = cachedSource.getCached(panelId);
    if (!hit) return null;
    if (hit.rows.length > 0 && !(timeDim in hit.rows[0] && valueMember in hit.rows[0])) return null;
    return hit.rows.slice(0, RECENT);
  };
  const cachedLevel = cachedTrend(sections.levelTimeDimension, sections.levelMember);
  const cachedRecharge = cachedTrend(sections.rechargeTimeDimension, sections.rechargeMember);
  const holdLive = cachedSource ? !cachedSource.ready : false;

  // Deps use a BOOLEAN projection of the cached arrays on purpose: cachedTrend
  // returns a fresh array each render, so depending on the array identity would
  // rebuild the query object every render and re-trigger the live hook's effect.
  const levelQ = useMemo(
    () =>
      holdLive || cachedLevel
        ? null
        : trendQuery(sections.levelTimeDimension, sections.levelMember, uid),
    [sections, uid, holdLive, cachedLevel != null],
  );
  const rechargeQ = useMemo(
    () =>
      holdLive || cachedRecharge
        ? null
        : trendQuery(sections.rechargeTimeDimension, sections.rechargeMember, uid),
    [sections, uid, holdLive, cachedRecharge != null],
  );

  const { rows: liveLevelRows } = useMemberCubeQuery<Record<string, unknown>>(gameId, levelQ);
  const { rows: liveRechargeRows } = useMemberCubeQuery<Record<string, unknown>>(gameId, rechargeQ);
  const levelRows = cachedLevel ?? liveLevelRows;
  const rechargeRows = cachedRecharge ?? liveRechargeRows;

  const levelData = useMemo(
    () =>
      [...levelRows]
        .reverse()
        .map((r) => ({
          x: String(r[sections.levelTimeDimension] ?? '').slice(0, 10),
          y: Number(r[sections.levelMember] ?? 0),
        }))
        .filter((d) => d.x),
    [levelRows, sections],
  );
  const rechargeData = useMemo(
    () =>
      [...rechargeRows]
        .reverse()
        .map((r) => ({
          x: String(r[sections.rechargeTimeDimension] ?? '').slice(0, 10),
          y: Number(r[sections.rechargeMember] ?? 0),
        }))
        .filter((d) => d.x),
    [rechargeRows, sections],
  );

  return (
    <SectionCard icon="🗺️" title={t('segments.member360.journey', { defaultValue: 'Journey' })}>
      {/* milestone timeline */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 16, marginBottom: 8 }}>
        {sections.milestones.map((m, i) => (
          <div key={m.field} style={{ flex: 1, minWidth: 110, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: 'var(--brand)',
                  border: '3px solid var(--brand-soft)',
                  flexShrink: 0,
                }}
              />
              {i < sections.milestones.length - 1 && (
                <span style={{ flex: 1, height: 2, background: 'var(--border-card)' }} />
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{m.label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              {row ? formatCell(row[qualify(m.field)]) : '—'}
            </div>
          </div>
        ))}
      </div>

      {/* two trend charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <ChartBlock title={t('segments.member360.levelProgression', { defaultValue: 'Level progression (last ≤31d)' })}>
          {levelData.length > 0 ? (
            <LineChart data={levelData} height={170} />
          ) : (
            <Empty t={t} />
          )}
        </ChartBlock>
        <ChartBlock title={t('segments.member360.dailyRecharge', { defaultValue: 'Daily recharge VND (last ≤31d)' })}>
          {rechargeData.length > 0 ? (
            <MiniBarChart data={rechargeData} height={170} />
          ) : (
            <Empty t={t} />
          )}
        </ChartBlock>
      </div>
    </SectionCard>
  );
}

function ChartBlock({ title, children }: { title: string; children: ReactElement }): ReactElement {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Empty({ t }: { t: (k: string, o?: Record<string, unknown>) => string }): ReactElement {
  return (
    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '24px 0' }}>
      {t('segments.member360.empty', { defaultValue: 'No data in this window' })}
    </div>
  );
}
