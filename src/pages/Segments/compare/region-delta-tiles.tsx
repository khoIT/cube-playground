/**
 * Delta KPI tiles for the compare surface: A-only / both / B-only counts (each
 * with a "Save as segment" action) plus a Jaccard tile. Counts come from the
 * overlap response; percentages are of the union so the three regions read as
 * shares of one whole.
 */

import { ReactElement } from 'react';
import type { OverlapRegion, OverlapResponse } from '../../../api/segment-compare-client';
import styles from './compare.module.css';

interface Props {
  data: OverlapResponse;
  /** Region currently being saved (disables its button); null when idle. */
  savingRegion: OverlapRegion | null;
  onSaveRegion: (region: OverlapRegion) => void;
}

function pctOfUnion(count: number, union: number): string {
  if (union <= 0) return '—';
  return `${((count / union) * 100).toFixed(1)}% of union`;
}

export function RegionDeltaTiles({ data, savingRegion, onSaveRegion }: Props): ReactElement {
  const union = data.a_only + data.both + data.b_only;
  const tiles: Array<{ region: OverlapRegion; label: string; count: number; cls: string }> = [
    { region: 'aOnly', label: `${data.a.name} only`, count: data.a_only, cls: styles.tileAOnly },
    { region: 'both', label: 'In both', count: data.both, cls: styles.tileBoth },
    { region: 'bOnly', label: `${data.b.name} only`, count: data.b_only, cls: styles.tileBOnly },
  ];

  return (
    <div className={styles.tilesGrid}>
      {tiles.map((tile) => (
        <div key={tile.region} className={`${styles.tile} ${tile.cls}`}>
          <span className={styles.tileLabel}>{tile.label}</span>
          <span className={styles.tileValue}>{tile.count.toLocaleString()}</span>
          <span className={styles.tileSub}>{pctOfUnion(tile.count, union)}</span>
          <button
            type="button"
            className={styles.tileSaveBtn}
            disabled={tile.count === 0 || savingRegion != null}
            onClick={() => onSaveRegion(tile.region)}
          >
            {savingRegion === tile.region ? 'Saving…' : 'Save as segment'}
          </button>
        </div>
      ))}
      <div className={`${styles.tile} ${styles.tileJaccard}`}>
        <span className={styles.tileLabel}>Jaccard</span>
        <span className={styles.tileValue}>{(data.jaccard * 100).toFixed(1)}%</span>
        <span className={styles.tileSub}>overlap ÷ union</span>
      </div>
    </div>
  );
}
