/** Sample Users tab — paginated random sample of the segment's uid_list. */

import { ReactElement, useMemo, useState } from 'react';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import type { Segment } from '../../../../types/segment-api';
import styles from '../../segments.module.css';

interface Props {
  segment: Segment;
}

const PAGE_SIZE = 25;
const SAMPLE_SIZE = 50;

function shuffle<T>(arr: readonly T[], seed: number): T[] {
  // Fisher-Yates with a seeded LCG so reshuffles are deterministic per click.
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

export function SampleUsersTab({ segment }: Props): ReactElement {
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
            <th>#</th>
            <th>{t('segments.detail.sampleUsers.noColumn')}</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((uid, idx) => (
            <tr key={`${uid}-${idx}`}>
              <td style={{ width: 64, color: 'var(--text-tertiary)' }}>
                {page * PAGE_SIZE + idx + 1}
              </td>
              <td style={{ fontFamily: 'var(--font-mono)' }}>{uid}</td>
            </tr>
          ))}
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
      </div>
    </div>
  );
}
