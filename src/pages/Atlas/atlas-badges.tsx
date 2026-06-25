/**
 * Feature Atlas — small shared presentational badges (status pill, health pill,
 * drawback/dep count chips, effort tag). Used by every view + the drawer so the
 * §2 encoding renders identically everywhere.
 */
import type { ReactElement } from 'react';
import { EFFORT_TOKENS, HEALTH_TOKENS, STATUS_TOKENS } from './atlas-encoding';
import type { Effort, FeatureHealth, FeatureStatus } from './atlas-types';

export function StatusPill({ status }: { status: FeatureStatus }): ReactElement {
  const t = STATUS_TOKENS[status];
  return (
    <span className="atlas-pill" style={{ background: t.soft, color: t.ink }}>
      {t.label}
    </span>
  );
}

export function HealthPill({ health }: { health: FeatureHealth }): ReactElement {
  const t = HEALTH_TOKENS[health];
  return (
    <span className="atlas-pill" style={{ background: t.soft, color: t.ink }}>
      <span className="atlas-dot" style={{ background: t.ink }} />
      {t.label}
    </span>
  );
}

export function EffortTag({ effort }: { effort: Effort | null }): ReactElement | null {
  if (!effort) return null;
  const t = EFFORT_TOKENS[effort];
  return (
    <span className="atlas-ef" style={{ color: t.ink, borderColor: t.ink }}>
      {t.label}
    </span>
  );
}

export function DrawbackCount({ n }: { n: number }): ReactElement | null {
  if (n <= 0) return null;
  return (
    <span className="atlas-count" style={{ background: 'var(--destructive-soft)', color: 'var(--destructive-ink)' }} title={`${n} known drawback(s)`}>
      ⚠ {n}
    </span>
  );
}

export function DepCount({ n }: { n: number }): ReactElement | null {
  if (n <= 0) return null;
  return (
    <span className="atlas-count" style={{ background: 'var(--info-soft)', color: 'var(--info-ink)' }} title={`${n} dependency(ies)`}>
      ↳ {n}
    </span>
  );
}
