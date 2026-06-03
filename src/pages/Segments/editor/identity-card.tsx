/** Name + cube + visibility fields for the segment editor. */

import { ReactElement } from 'react';
import { Input, Select } from 'antd';
import { useIdentityMap } from '../../../hooks/use-identity-map';
import type { SegmentVisibility } from '../../../types/segment-api';
import styles from '../segments.module.css';

interface Props {
  name: string;
  cube: string | null;
  visibility: SegmentVisibility;
  /** Admins may set 'org'; everyone else is limited to personal/shared. */
  canSetOrg: boolean;
  onNameChange: (name: string) => void;
  onCubeChange: (cube: string) => void;
  onVisibilityChange: (v: SegmentVisibility) => void;
}

const VISIBILITY_LABELS: Record<SegmentVisibility, string> = {
  personal: 'Personal — only you',
  shared: 'Shared — everyone in this workspace',
  org: 'Org-wide — visible across the org',
};

export function IdentityCard({
  name,
  cube,
  visibility,
  canSetOrg,
  onNameChange,
  onCubeChange,
  onVisibilityChange,
}: Props): ReactElement {
  const { mappings, hasIdentityFor } = useIdentityMap();
  const cubeOptions = mappings.filter((m) => hasIdentityFor(m.cube));
  const visibilityOptions = (['personal', 'shared', 'org'] as SegmentVisibility[])
    .filter((v) => v !== 'org' || canSetOrg)
    .map((v) => ({ value: v, label: VISIBILITY_LABELS[v] }));

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
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel}>Visibility</label>
        <Select
          value={visibility}
          onChange={(v) => onVisibilityChange(v as SegmentVisibility)}
          options={visibilityOptions}
        />
      </div>
    </div>
  );
}
