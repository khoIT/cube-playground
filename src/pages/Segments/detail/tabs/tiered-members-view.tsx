/**
 * LTV-tiered Members view — replaces the random sample when the server has
 * computed member tiers (segment.member_tiers, refresh-time). Renders a tier
 * selector (Top/Middle/Bottom 50 by LTV, or "All N" for small cohorts), an
 * LTV column straight from the stored tier data (zero extra Cube queries),
 * and the preset's enrichment columns via the existing live path.
 *
 * Searching switches to a substring match across the FULL uid list — the same
 * contract as the legacy sample view; LTV shows only for uids in the sample.
 */

import { ReactElement, useMemo, useState } from 'react';
import { Button, Input } from 'antd';
import { Download, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNowStrict } from 'date-fns';
import type { MemberTiers, Segment, TierMember, TierName } from '../../../../types/segment-api';
import type { Preset } from '../../presets/types';
import { useMemberDimRows, memberColumnField } from './use-member-dim-rows';
import { hasMember360 } from '../../member360/member360-panels';
import { Member360UnavailableChip } from '../../member360/member360-unavailable-chip';
import { formatValue } from '../cards/format-value';
import {
  MemberIdentityCell,
  SortableHeader,
  SortState,
  columnsWithData,
  splitNameColumn,
  compareValues,
  downloadCsv,
  formatCell,
} from './member-table-shared';
import { TierSelector } from './tier-selector';
import { tierOptions, buildLtvByUid, searchPool, rankColumnSpec } from './tier-view-model';
import { MemberCacheChip, useMemberCacheStatus } from './member-cache-chip';
import { MembershipFreshnessChip } from './membership-freshness-chip';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
  preset: Preset | null;
  tiers: MemberTiers;
}

const PAGE_SIZE = 25;

function formatWhen(value: string): string {
  try {
    return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
  } catch {
    return '—';
  }
}

export function TieredMembersView({ segment, preset, tiers }: Props): ReactElement {
  const { t } = useTranslation();
  const options = useMemo(() => tierOptions(tiers), [tiers]);
  const [activeTier, setActiveTier] = useState<TierName>(options[0]?.name ?? 'top');
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);

  const ltvByUid = useMemo(() => buildLtvByUid(tiers), [tiers]);
  // The ranking column is the segment's defining measure when its predicate
  // filters on one — label/format follow the matching preset member column.
  const rankCol = useMemo(
    () => rankColumnSpec(tiers, preset?.memberColumns),
    [tiers, preset?.memberColumns],
  );
  const searching = search.trim().length > 0;

  // Pool: the active tier's ranked members, or a full-uid-list search.
  const pool: TierMember[] = useMemo(() => {
    if (searching) return searchPool(segment.uid_list ?? [], ltvByUid, search);
    return tiers.tiers[activeTier] ?? [];
  }, [searching, search, segment.uid_list, ltvByUid, tiers, activeTier]);

  const pageCount = Math.max(1, Math.ceil(pool.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = pool.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const pageUids = useMemo(() => pageRows.map((m) => m.uid), [pageRows]);

  const { byUid, loading: dimsLoading, columns } = useMemberDimRows(segment, preset, pageUids);
  // The stored tier LTV replaces the preset's live LTV column for DISPLAY —
  // rendering both would show the same value twice. (The enrichment query
  // still requests the measure; one extra measure on a 25-row page is noise.)
  // Columns that came back empty for every visible row are dropped once the
  // dim query settles — no dead all-dash columns.
  // The in-game-name column renders inside the identity cell, not as a column.
  const { nameField, dataColumns: enrichColumns } = useMemo(
    () =>
      splitNameColumn(
        columnsWithData(
          columns.filter((c) => memberColumnField(c) !== tiers.ltv_measure),
          byUid,
          pageUids,
          dimsLoading,
        ),
      ),
    [columns, tiers.ltv_measure, byUid, pageUids, dimsLoading],
  );
  const member360Enabled = hasMember360(segment.game_id);
  // Per-member precompute readiness (one aggregate fetch; null until loaded —
  // the chip column only renders once real data exists).
  const cacheStatus = useMemberCacheStatus(segment.id, member360Enabled);

  const sortedPageRows = useMemo(() => {
    if (!sort) return pageRows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    const out = pageRows.slice();
    out.sort((a, b) => {
      if (sort.col === 'uid') return a.uid.localeCompare(b.uid) * dir;
      if (sort.col === 'ltv') return compareValues(a.ltv, b.ltv) * dir;
      return compareValues(byUid.get(a.uid)?.[sort.col], byUid.get(b.uid)?.[sort.col]) * dir;
    });
    return out;
  }, [pageRows, sort, byUid]);

  function toggleSort(col: string): void {
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return null;
    });
  }

  const caption = searching
    ? t('segments.detail.sampleUsers.matchedCount', {
        defaultValue: '{{n}} matched of {{total}}',
        n: pool.length,
        total: segment.uid_count,
      })
    : tiers.tiers.all
      ? t('segments.detail.members.tiers.captionAll', {
          defaultValue: 'All {{n}} members ranked by {{metric}} · computed {{when}}',
          n: tiers.tiers.all.length,
          metric: rankCol.label,
          when: formatWhen(tiers.computed_at),
        })
      : t('segments.detail.members.tiers.caption', {
          defaultValue: 'Top / middle / bottom 50 by {{metric}} of {{total}} members · computed {{when}}',
          metric: rankCol.label,
          total: segment.uid_count,
          when: formatWhen(tiers.computed_at),
        });

  return (
    <div className={styles.tabBody}>
      <div className={styles.sampleControls}>
        <div style={{ display: 'inline-flex', gap: 10, alignItems: 'center', color: 'var(--text-secondary)', fontSize: 12 }} title={tiers.computed_at}>
          <span>{caption}</span>
          <MembershipFreshnessChip segment={segment} />
          {!member360Enabled && <Member360UnavailableChip gameId={segment.game_id} />}
        </div>
        <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <Input
            prefix={<Search size={13} aria-hidden />}
            placeholder={t('segments.detail.sampleUsers.searchPlaceholder', {
              defaultValue: 'Search uid…',
            })}
            value={search}
            allowClear
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            style={{ width: 220 }}
          />
          <Button
            type="primary"
            icon={<Download size={13} aria-hidden />}
            onClick={() => downloadCsv(segment.uid_list, segment.name)}
          >
            {t('segments.detail.sampleUsers.exportAll')}
          </Button>
        </div>
      </div>

      <div style={{ margin: '12px 0' }}>
        <TierSelector
          options={options}
          active={activeTier}
          onChange={(tier) => {
            setActiveTier(tier);
            setPage(0);
            setSort(null);
          }}
          disabled={searching}
        />
      </div>

      <table className={styles.sampleTable}>
        <thead>
          <tr>
            <th style={{ width: 56 }}>#</th>
            <SortableHeader
              label={t('segments.detail.sampleUsers.noColumn')}
              colKey="uid"
              sort={sort}
              onToggle={toggleSort}
            />
            <SortableHeader
              label={rankCol.label}
              colKey="ltv"
              sort={sort}
              onToggle={toggleSort}
            />
            {cacheStatus && (
              <th style={{ width: 72 }}>
                {t('segments.detail.members.cache.column', { defaultValue: '360' })}
              </th>
            )}
            {enrichColumns.map((c) => (
              <SortableHeader
                key={c.id}
                label={c.label}
                colKey={memberColumnField(c)}
                sort={sort}
                onToggle={toggleSort}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedPageRows.map((member, idx) => {
            const dimRow = byUid.get(member.uid);
            return (
              <tr key={`${member.uid}-${idx}`}>
                <td style={{ width: 56, color: 'var(--text-muted)' }}>
                  {safePage * PAGE_SIZE + idx + 1}
                </td>
                <MemberIdentityCell
                  uid={member.uid}
                  // Prefer the refresh-time stored name (always present once
                  // computed, independent of the live dim query); fall back to
                  // the live value for tiers predating the field, then the uid.
                  name={
                    member.name ??
                    (nameField ? ((dimRow?.[nameField] as string | undefined) ?? null) : null)
                  }
                  segmentId={segment.id}
                  member360Enabled={member360Enabled}
                  linkTitle={t('segments.member360.openTooltip', { defaultValue: 'Open 360 profile' })}
                />
                <td>{member.ltv == null ? '—' : formatValue(member.ltv, rankCol.format)}</td>
                {cacheStatus && (
                  <td>
                    <MemberCacheChip status={cacheStatus} uid={member.uid} />
                  </td>
                )}
                {enrichColumns.map((c) => (
                  <td key={c.id} className={styles.memberDimCell}>
                    {dimsLoading && !dimRow
                      ? '…'
                      : formatCell(dimRow?.[memberColumnField(c)], c.format)}
                  </td>
                ))}
              </tr>
            );
          })}
          {sortedPageRows.length === 0 && (
            <tr>
              <td
                colSpan={(cacheStatus ? 4 : 3) + enrichColumns.length}
                style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}
              >
                {t('segments.detail.sampleUsers.noMatches', {
                  defaultValue: 'No uids match this search.',
                })}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className={styles.paginator} style={{ marginTop: 12 }}>
        <Button size="small" disabled={safePage === 0} onClick={() => setPage((p) => p - 1)}>‹</Button>
        <span>
          Page {safePage + 1} / {pageCount}
        </span>
        <Button size="small" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>›</Button>
      </div>
    </div>
  );
}
