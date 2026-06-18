/**
 * Shared annotation strip rendered under each Movement chart: freshness (asOf,
 * GMT+7 — the snapshot writer already buckets ts to GMT+7), a stale badge when
 * a last-good payload was served on upstream error, cadence-change notes, and a
 * carry-forward hint when the chosen view granularity is finer than captured
 * (values hold flat between snapshots — not fabricated detail).
 */

import { ReactElement } from 'react';
import type { CadenceChange } from '../../../../../api/segment-movement-client';

interface Props {
  asOf: string | null;
  stale?: boolean;
  cadenceChanges?: CadenceChange[];
  carryForward?: string[];
}

function Chip({ children, tone }: { children: string; tone: 'muted' | 'warning' | 'info' }): ReactElement {
  const map = {
    muted: { bg: 'var(--muted-soft)', ink: 'var(--muted-ink)' },
    warning: { bg: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
    info: { bg: 'var(--info-soft)', ink: 'var(--info-ink)' },
  } as const;
  return (
    <span
      style={{
        background: map[tone].bg,
        color: map[tone].ink,
        borderRadius: 'var(--radius-full)',
        padding: '2px 8px',
        fontSize: 10.5,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function MovementMetaStrip({ asOf, stale, cadenceChanges, carryForward }: Props): ReactElement | null {
  const changes = cadenceChanges ?? [];
  const carried = carryForward ?? [];
  if (!asOf && !stale && changes.length === 0 && carried.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8 }}>
      {asOf && <Chip tone="muted">{`as of ${asOf} (GMT+7)`}</Chip>}
      {stale && <Chip tone="warning">stale — last good data</Chip>}
      {changes.length > 0 && (
        <Chip tone="info">
          {changes.length === 1
            ? `cadence changed ${changes[0].from} → ${changes[0].to}`
            : `${changes.length} cadence changes in range`}
        </Chip>
      )}
      {carried.length > 0 && (
        <Chip tone="muted">finer than captured — values held flat between snapshots</Chip>
      )}
    </div>
  );
}
