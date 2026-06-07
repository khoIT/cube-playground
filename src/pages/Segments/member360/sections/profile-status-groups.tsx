/**
 * Profile & status — subtitled KV clusters (Identity / Progression & health)
 * topped by a categorical status-chips row. Engagement/lifecycle render as
 * soft chips here (their KV duplicate rows were retired); the hero keeps its
 * derived badge copies on the gradient.
 */

import { ReactElement } from 'react';
import type { FieldRef } from '../member360-sections';
import { qualify } from '../member360-sections';
import { KvList } from './dashboard-stats';
import { SoftChip, toneForStatus } from './soft-chip';

export function ProfileStatusGroups({
  groups,
  statusChips,
  row,
}: {
  groups: { title: string; fields: FieldRef[] }[];
  statusChips: FieldRef[];
  row: Record<string, unknown> | null;
}): ReactElement {
  const chips = statusChips
    .map((f) => ({ f, v: row?.[qualify(f.field)] }))
    .filter((c) => c.v != null && c.v !== '');
  return (
    <div>
      {chips.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {chips.map((c) => (
            <SoftChip key={c.f.field} icon={c.f.icon} tone={toneForStatus(String(c.v))}>
              {String(c.v)}
            </SoftChip>
          ))}
        </div>
      )}
      {groups.map((g, i) => (
        <div key={g.title} style={{ marginTop: i === 0 ? 0 : 14 }}>
          <h4
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              margin: '0 0 4px',
            }}
          >
            {g.title}
          </h4>
          <KvList fields={g.fields} row={row} />
        </div>
      ))}
    </div>
  );
}
