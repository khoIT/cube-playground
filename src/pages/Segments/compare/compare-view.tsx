/**
 * /segments/compare?a&b — overlap of two segments: Venn (area ∝ size), delta
 * tiles with save-as-segment, and a deferred per-region metric table. Set math
 * runs server-side over the nightly membership snapshot, so this page issues one
 * counts request and (on demand) the region-metric reads — never a live scan.
 */

import { ReactElement, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { message } from 'antd';
import { GitCompareArrows, TriangleAlert } from 'lucide-react';
import { segmentCompareClient, type OverlapRegion } from '../../../api/segment-compare-client';
import { SegmentApiError } from '../../../api/api-client';
import { invalidateSegmentIds } from '../use-segment-ids';
import { useSegmentOverlap } from './use-segment-overlap';
import { OverlapVenn } from './overlap-venn';
import { RegionDeltaTiles } from './region-delta-tiles';
import { RegionMetricTable } from './region-metric-table';
import segStyles from '../segments.module.css';
import styles from './compare.module.css';

const REGION_NAME: Record<OverlapRegion, string> = {
  aOnly: 'A-only', both: 'In both', bOnly: 'B-only',
};

export function CompareView(): ReactElement {
  const history = useHistory();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const a = params.get('a');
  const b = params.get('b');

  const { data, loading, error } = useSegmentOverlap(a, b);
  const [savingRegion, setSavingRegion] = useState<OverlapRegion | null>(null);

  async function handleSaveRegion(region: OverlapRegion): Promise<void> {
    if (!data) return;
    setSavingRegion(region);
    const name = `${data.a.name} ∩ ${data.b.name} · ${REGION_NAME[region]}`;
    try {
      const res = await segmentCompareClient.saveRegion(data.a.id, data.b.id, region, name);
      invalidateSegmentIds();
      message.success(`Saved ${res.uid_count.toLocaleString()} members as a segment`);
      history.push(`/segments/${res.id}`);
    } catch (err) {
      message.error(err instanceof SegmentApiError ? err.message : 'Could not save region');
    } finally {
      setSavingRegion(null);
    }
  }

  const stale = data ? data.a.stale || data.b.stale : false;

  return (
    <main className={segStyles.page}>
      <div className={segStyles.fleetHead}>
        <span className={segStyles.fleetHeadIcon}><GitCompareArrows size={18} aria-hidden /></span>
        <div>
          <h1>Compare segments</h1>
          <div className={segStyles.fleetMeta}>
            Overlap, deltas, and per-region metrics over the nightly membership snapshot
          </div>
        </div>
      </div>

      {error && (
        <div className={segStyles.errorState}>
          {error.code === 'CROSS_GAME'
            ? 'These segments belong to different games — overlap is undefined.'
            : error.code === 'MISSING_IDS'
              ? 'Select exactly two segments in the library, then choose “Compare”.'
              : error.message}
        </div>
      )}

      {loading && <div className={styles.tileSub}>Computing overlap…</div>}

      {data && (
        <>
          {stale && (
            <div className={styles.staleCallout}>
              <TriangleAlert size={15} aria-hidden />
              <span>
                One or both snapshots are over 24h old — counts reflect the last nightly capture, not live membership.
              </span>
            </div>
          )}

          <div className={styles.pickerRow}>
            <span className={styles.pickerCell}>
              <span className={`${styles.pickerSwatch} ${styles.swatchA}`} />
              {data.a.name} · {data.a_size.toLocaleString()}
            </span>
            <span className={styles.pickerCell}>
              <span className={`${styles.pickerSwatch} ${styles.swatchB}`} />
              {data.b.name} · {data.b_size.toLocaleString()}
            </span>
          </div>

          <div className={styles.overlapGrid}>
            <div className={styles.vennCard}>
              <OverlapVenn
                aSize={data.a_size}
                bSize={data.b_size}
                both={data.both}
                aLabel={data.a.name}
                bLabel={data.b.name}
              />
              <div className={styles.vennLegend}>
                <span className={styles.vennLegendItem}>
                  <span className={`${styles.pickerSwatch} ${styles.swatchA}`} />
                  {data.a.name}
                </span>
                <span className={styles.vennLegendItem}>
                  <span className={`${styles.pickerSwatch} ${styles.swatchB}`} />
                  {data.b.name}
                </span>
              </div>
            </div>

            <RegionDeltaTiles data={data} savingRegion={savingRegion} onSaveRegion={handleSaveRegion} />
          </div>

          <RegionMetricTable data={data} />
        </>
      )}
    </main>
  );
}

export default CompareView;
