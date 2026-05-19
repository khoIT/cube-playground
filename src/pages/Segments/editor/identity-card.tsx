/** Name + cube fields for the segment editor. */

import { ReactElement } from 'react';
import { Input, Select } from 'antd';
import { useIdentityMap } from '../../../hooks/use-identity-map';
import styles from '../segments.module.css';

interface Props {
  name: string;
  cube: string | null;
  onNameChange: (name: string) => void;
  onCubeChange: (cube: string) => void;
}

export function IdentityCard({ name, cube, onNameChange, onCubeChange }: Props): ReactElement {
  const { mappings, hasIdentityFor } = useIdentityMap();
  const cubeOptions = mappings.filter((m) => hasIdentityFor(m.cube));

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
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel}>Segment name</label>
        <Input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="e.g. High-value retained players" />
      </div>
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel}>Primary cube</label>
        <Select
          value={cube ?? undefined}
          onChange={(v) => onCubeChange(v as string)}
          placeholder="Select a cube with mapped identity field"
          options={cubeOptions.map((c) => ({ value: c.cube, label: `${c.cube} (${c.identity_field})` }))}
        />
      </div>
    </div>
  );
}
