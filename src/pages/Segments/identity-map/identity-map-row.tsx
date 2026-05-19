/** A single cube → identity-field row in the identity-map settings list. */

import { ReactElement } from 'react';
import { Button, Input } from 'antd';
import styles from '../segments.module.css';
import type { CubeIdentityMapping } from '../../../types/segment-api';

interface MergedRow extends CubeIdentityMapping {
  is_suggested?: boolean;
  matched_pattern?: string | null;
}

interface Props {
  row: MergedRow;
  onSave: (cube: string, field: string) => void;
  onReset: (cube: string) => void;
  pending: boolean;
}

export function IdentityMapRow({ row, onSave, onReset, pending }: Props): ReactElement {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1.5fr 180px 120px',
        gap: 12,
        padding: '10px 16px',
        borderBottom: '1px solid var(--border-card-subtle, var(--border-card))',
        alignItems: 'center',
      }}
    >
      <strong style={{ fontSize: 13 }}>{row.cube}</strong>
      <Input
        defaultValue={row.identity_field ?? ''}
        placeholder="cube.user_id"
        onPressEnter={(e) => {
          const v = (e.currentTarget.value ?? '').trim();
          if (v) onSave(row.cube, v);
        }}
        onBlur={(e) => {
          const v = (e.currentTarget.value ?? '').trim();
          if (v && v !== row.identity_field) onSave(row.cube, v);
        }}
        disabled={pending}
      />
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {row.is_suggested ? (
          <span className={styles.staticBadge}>
            auto-suggest{row.matched_pattern ? ` (${row.matched_pattern})` : ''}
          </span>
        ) : (
          'manual override'
        )}
      </span>
      {row.is_suggested ? (
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>—</span>
      ) : (
        <Button size="small" onClick={() => onReset(row.cube)} disabled={pending}>
          Reset
        </Button>
      )}
    </div>
  );
}
