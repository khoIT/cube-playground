/**
 * Sample Users tab — paginated random sample of the segment's uid_list,
 * enriched with preset.memberColumns (e.g. LTV, lifecycle, last active, joined).
 *
 * When the user types in the search box, the random sample is bypassed and
 * the full uid_list is filtered by substring match. Column headers are
 * click-to-sort (current-page rows only; cross-page sort would require
 * loading dim data for every uid).
 */

import { ReactElement, useMemo, useState } from 'react';
import { Button, Input } from 'antd';
import { Search, ArrowUp, ArrowDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { Segment } from '../../../../types/segment-api';
import type { Preset } from '../../presets/types';
import { useMemberDimRows, memberColumnField } from './use-member-dim-rows';
import { hasMember360 } from '../../member360/member360-panels';
import { formatValue } from '../cards/format-value';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
  preset: Preset | null;
}

const PAGE_SIZE = 25;
const SAMPLE_SIZE = 50;

type SortDir = 'asc' | 'desc';
interface SortState {
  col: string; // 'uid' or memberColumnField()
  dir: SortDir;
}

function shuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = arr.slice();
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function downloadCsv(uids: string[], name: string) {
  const blob = new Blob(['uid\n' + uids.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w-]+/g, '_')}-uids.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatCell(value: unknown, format?: string): string {
  if (value == null || value === '') return '—';
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return formatValue(value, format as never);
}

function compareValues(a: unknown, b: unknown): number {
  const aNull = a == null || a === '';
  const bNull = b == null || b === '';
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const an = typeof a === 'number' ? a : Number(a);
  const bn = typeof b === 'number' ? b : Number(b);
  if (!Number.isNaN(an) && !Number.isNaN(bn) && typeof a !== 'string' && typeof b !== 'string') {
    return an - bn;
  }
  return String(a).localeCompare(String(b));
}

export function SampleUsersTab({ segment, preset }: Props): ReactElement {
  const { t } = useTranslation();
  const [seed, setSeed] = useState<number>(() => Date.now() % 233_280);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);

  // Pool of uids to show: random sample by default; search switches to a
  // substring match across the full uid_list.
  const pool = useMemo(() => {
    const uids = segment.uid_list ?? [];
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      return uids.filter((uid) => uid.toLowerCase().includes(needle));
    }
    if (uids.length <= SAMPLE_SIZE) return shuffle(uids, seed);
    return shuffle(uids, seed).slice(0, SAMPLE_SIZE);
  }, [segment.uid_list, seed, search]);

  const pageCount = Math.max(1, Math.ceil(pool.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = pool.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const { byUid, loading: dimsLoading, columns } = useMemberDimRows(segment, preset, pageRows);
  const hasDims = columns.length > 0;
  const member360Enabled = hasMember360(segment.game_id);

  // Sort within the current page (we only have dim data for what's loaded).
  const sortedPageRows = useMemo(() => {
    if (!sort) return pageRows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    const out = pageRows.slice();
    out.sort((aUid, bUid) => {
      if (sort.col === 'uid') return aUid.localeCompare(bUid) * dir;
      const a = byUid.get(aUid)?.[sort.col];
      const b = byUid.get(bUid)?.[sort.col];
      return compareValues(a, b) * dir;
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

  if (!segment.uid_list || segment.uid_list.length === 0) {
    return (
      <div className={styles.tabBody}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {t('segments.detail.sampleUsers.empty')}
        </p>
      </div>
    );
  }

  const totalUids = segment.uid_count;
  const summaryText = search.trim()
    ? t('segments.detail.sampleUsers.matchedCount', {
        defaultValue: '{{n}} matched of {{total}}',
        n: pool.length,
        total: totalUids,
      })
    : `${pool.length} / ${totalUids}`;

  return (
    <div className={styles.tabBody}>
      <div className={styles.sampleControls}>
        <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
          {t('segments.detail.sampleUsers.description')} ({summaryText})
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
            onClick={() => {
              setSeed(Date.now() % 233_280);
              setPage(0);
            }}
            disabled={search.trim().length > 0}
          >
            {t('segments.detail.sampleUsers.reshuffle')}
          </Button>
          <Button
            type="primary"
            onClick={() => downloadCsv(segment.uid_list, segment.name)}
          >
            {t('segments.detail.sampleUsers.exportAll')}
          </Button>
        </div>
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
            {columns.map((c) => (
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
          {sortedPageRows.map((uid, idx) => {
            const dimRow = byUid.get(uid);
            return (
              <tr key={`${uid}-${idx}`}>
                <td style={{ width: 56, color: 'var(--text-tertiary)' }}>
                  {safePage * PAGE_SIZE + idx + 1}
                </td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>
                  {member360Enabled ? (
                    <Link
                      to={`/segments/${segment.id}/members/${encodeURIComponent(uid)}`}
                      style={{ color: 'var(--brand)', textDecoration: 'none' }}
                      title={t('segments.member360.openTooltip', { defaultValue: 'Open 360 profile' })}
                    >
                      {uid}
                    </Link>
                  ) : (
                    uid
                  )}
                </td>
                {columns.map((c) => (
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
              <td colSpan={2 + columns.length} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 16 }}>
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
        <Button
          size="small"
          disabled={safePage >= pageCount - 1}
          onClick={() => setPage((p) => p + 1)}
        >›</Button>
        {hasDims && (
          <span style={{ marginLeft: 12, color: 'var(--text-muted)', fontSize: 11 }}>
            {dimsLoading
              ? t('segments.detail.sampleUsers.dimsLoading', { defaultValue: 'Loading member info…' })
              : t('segments.detail.sampleUsers.dimsCount', {
                  defaultValue: '{{n}} columns from {{cube}}',
                  n: columns.length,
                  cube: preset?.hubCube ?? '',
                })}
          </span>
        )}
      </div>
    </div>
  );
}

interface SortableHeaderProps {
  label: string;
  colKey: string;
  sort: SortState | null;
  onToggle: (col: string) => void;
}

function SortableHeader({ label, colKey, sort, onToggle }: SortableHeaderProps): ReactElement {
  const active = sort?.col === colKey;
  const dir = active ? sort?.dir : null;
  return (
    <th
      className={styles.sortableHeader}
      onClick={() => onToggle(colKey)}
      data-active={active || undefined}
    >
      <span>{label}</span>
      {dir === 'asc' && <ArrowUp size={12} aria-hidden />}
      {dir === 'desc' && <ArrowDown size={12} aria-hidden />}
    </th>
  );
}
