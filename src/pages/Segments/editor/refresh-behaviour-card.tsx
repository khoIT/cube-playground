/** Refresh-mode toggle (Static vs Live) + cadence picker. */

import { ReactElement } from 'react';
import { Select } from 'antd';
import styles from '../segments.module.css';
import type { SegmentType } from '../../../types/segment-api';
import { cadenceOptionsFor } from '../refresh-cadence';

interface Props {
  type: SegmentType;
  cadenceMin: number | null;
  onTypeChange: (t: SegmentType) => void;
  onCadenceChange: (m: number | null) => void;
}

export function RefreshBehaviourCard({ type, cadenceMin, onTypeChange, onCadenceChange }: Props): ReactElement {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <label className={styles.fieldLabel}>Refresh behaviour</label>
      <div className={styles.typeChoices}>
        <button
          type="button"
          className={[styles.typeOption, type === 'manual' ? styles.typeOptionActive : ''].filter(Boolean).join(' ')}
          onClick={() => onTypeChange('manual')}
        >
          <div className={styles.typeOptionTitle}>Static</div>
          <div className={styles.typeOptionHint}>Snapshot. Never auto-refreshes.</div>
        </button>
        <button
          type="button"
          className={[styles.typeOption, type === 'predicate' ? styles.typeOptionActive : ''].filter(Boolean).join(' ')}
          onClick={() => onTypeChange('predicate')}
        >
          <div className={styles.typeOptionTitle}>Live</div>
          <div className={styles.typeOptionHint}>Predicate-backed. Refreshes on cadence.</div>
        </button>
      </div>
      {type === 'predicate' && (
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>Cadence</label>
          <Select
            value={cadenceMin ?? 60}
            onChange={(v) => onCadenceChange(v as number)}
            options={cadenceOptionsFor(cadenceMin ?? 60)}
          />
        </div>
      )}
    </div>
  );
}
