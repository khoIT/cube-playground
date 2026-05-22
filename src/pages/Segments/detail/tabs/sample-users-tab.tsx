/**
 * Sample Users tab — paginated random sample of the segment's uid_list,
 * enriched with preset.memberColumns (e.g. LTV, lifecycle, last active, joined).
 */

import { ReactElement, useMemo, useState } from 'react';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import type { Segment } from '../../../../types/segment-api';
import type { Preset } from '../../presets/types';
import { useMemberDimRows } from './use-member-dim-rows';
import { formatValue } from '../cards/format-value';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
  preset: Preset | null;
}

const PAGE_SIZE = 25;
const SAMPLE_SIZE = 50;

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

/** Best-effort date formatter — strips time when the value is a YYYY-MM-DD. */
function formatCell(value: unknown, format?: string): string {
  if (value == null || value === '') return '—';
  const s = String(value);
  // Date-ish: 2024-05-22 or 2024-05-22T...
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return formatValue(value, format as never);
}

export function SampleUsersTab({ segment, preset }: Props): ReactElement {
  const { t } = useTranslation();
  const [seed, setSeed] = useState<number>(() => Date.now() % 233_280);
  const [page, setPage] = useState(0);

  const sample = useMemo(() => {
    const uids = segment.uid_list ?? [];
    if (uids.length <= SAMPLE_SIZE) return shuffle(uids, seed);
    return shuffle(uids, seed).slice(0, SAMPLE_SIZE);
  }, [segment.uid_list, seed]);

  const pageRows = sample.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(sample.length / PAGE_SIZE));

  const { byUid, loading: dimsLoading, columns } = useMemberDimRows(segment, preset, pageRows);
  const hasDims = columns.length > 0;

  if (!segment.uid_list || segment.uid_list.length === 0) {
    return (
      <div className={styles.tabBody}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {t('segments.detail.sampleUsers.empty')}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.tabBody}>
      <div className={styles.sampleControls}>
        <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
          {t('segments.detail.sampleUsers.description')} ({sample.length} / {segment.uid_count})
        </div>
        <div style={{ display: 'inline-flex', gap: 8 }}>
          <Button
            onClick={() => {
              setSeed(Date.now() % 233_280);
              setPage(0);
            }}
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
            <th>{t('segments.detail.sampleUsers.noColumn')}</th>
            {columns.map((c) => (
              <th key={c.id}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((uid, idx) => {
            const dimRow = byUid.get(uid);
            return (
              <tr key={`${uid}-${idx}`}>
                <td style={{ width: 56, color: 'var(--text-tertiary)' }}>
                  {page * PAGE_SIZE + idx + 1}
                </td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{uid}</td>
                {columns.map((c) => (
                  <td key={c.id} className={styles.memberDimCell}>
                    {dimsLoading && !dimRow ? '…' : formatCell(dimRow?.[c.dimension], c.format)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className={styles.paginator} style={{ marginTop: 12 }}>
        <Button size="small" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹</Button>
        <span>
          Page {page + 1} / {pageCount}
        </span>
        <Button
          size="small"
          disabled={page >= pageCount - 1}
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
