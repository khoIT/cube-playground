/**
 * Deferred per-region metric table: "how the three regions differ". Loads only
 * on demand (one parallel fetch per region) because each region aggregate is a
 * scoped Cube read. Rows are the game's catalogued segmentable measures; columns
 * are A-only / both / B-only. Each cell shows the average with the median below.
 *
 * Exactness: the server computes the aggregate over the FULL region when it fits
 * Cube's identity-IN ceiling, and samples (with a disclosed flag) above it. Any
 * sampled region is surfaced so the numbers are never silently partial.
 */

import { ReactElement, useState } from 'react';
import {
  segmentCompareClient,
  type OverlapRegion,
  type OverlapResponse,
  type RegionMetricsResponse,
} from '../../../api/segment-compare-client';
import { SegmentApiError } from '../../../api/api-client';
import styles from './compare.module.css';

interface Props {
  data: OverlapResponse;
}

const REGIONS: OverlapRegion[] = ['aOnly', 'both', 'bOnly'];

function fmt(value: number | null, currency: 'vnd' | 'usd' | null): string {
  if (value == null) return '—';
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  const n = rounded.toLocaleString();
  if (currency === 'vnd') return `${n}₫`;
  if (currency === 'usd') return `$${n}`;
  return n;
}

export function RegionMetricTable({ data }: Props): ReactElement {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [byRegion, setByRegion] = useState<Record<OverlapRegion, RegionMetricsResponse | null>>({
    aOnly: null, both: null, bOnly: null,
  });

  const regionLabels: Record<OverlapRegion, string> = {
    aOnly: `${data.a.name} only`,
    both: 'In both',
    bOnly: `${data.b.name} only`,
  };

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        REGIONS.map((r) => segmentCompareClient.regionMetrics(data.a.id, data.b.id, r)),
      );
      const next = { aOnly: results[0], both: results[1], bOnly: results[2] };
      setByRegion(next);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof SegmentApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // Measure rows from whichever region returned a metrics block first.
  const measures =
    REGIONS.map((r) => byRegion[r]?.metrics?.measures).find((m) => m && m.length > 0) ?? [];
  const anySampled = REGIONS.some((r) => byRegion[r]?.metrics?.sampled);

  return (
    <section className={styles.metricSection}>
      <div className={styles.metricHeadRow}>
        <span className={styles.metricTitle}>How the three regions differ</span>
        {!loaded && (
          <button type="button" className={styles.loadMetricsBtn} onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Load region metrics'}
          </button>
        )}
      </div>

      {error && <div className={styles.metricSampled}>{error}</div>}

      {loaded && measures.length === 0 && !error && (
        <div className={styles.tileSub}>No catalogued measures for this game.</div>
      )}

      {loaded && measures.length > 0 && (
        <>
          <div className={styles.metricTableWrap}>
            <table className={styles.metricTable}>
              <thead>
                <tr>
                  <th>Measure</th>
                  {REGIONS.map((r) => (
                    <th key={r}>{regionLabels[r]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {measures.map((m) => (
                  <tr key={m.concept}>
                    <td>{m.label}</td>
                    {REGIONS.map((r) => {
                      const cell = byRegion[r]?.metrics?.measures.find((x) => x.concept === m.concept);
                      return (
                        <td key={r}>
                          <span className={styles.metricCellValue}>{fmt(cell?.avg ?? null, m.currency)}</span>
                          <span className={styles.metricCellMedian}>
                            med {fmt(cell?.median ?? null, m.currency)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {anySampled && (
            <div className={styles.metricSampled}>
              Some regions exceeded the exact-aggregate size; those columns are estimated from a sample.
            </div>
          )}
        </>
      )}
    </section>
  );
}
