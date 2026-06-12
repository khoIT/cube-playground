/**
 * Cube-segment scope chips for the predicate builder step.
 *
 * Shows ALL model-defined segments of the primary cube as toggleable chips.
 * Active chips (those in the stored sidecar) render highlighted. Owner/admin
 * can toggle them; non-owners see them disabled with an explanatory tooltip.
 *
 * Cross-cube sidecar entries (segments from joined cubes, e.g. mf_users.whales
 * on an active_daily segment) render read-only with their cube name labeled —
 * they are always preserved even when the owner edits primary-cube chips.
 *
 * A confirmation dialog fires when the user would remove the LAST time-bounding
 * segment (heuristic: name contains date-ish tokens) to guard against an
 * accidental unbounded-scan widening of the cohort.
 */

import { ReactElement } from 'react';
import { Button, Tooltip, Modal } from 'antd';
import { CheckOutlined, LockOutlined } from '@ant-design/icons';
import type { ModelSegmentEntry } from './predicate-builder/use-predicate-member-catalog';
import styles from '../segments.module.css';

/** Tokens that signal the segment scopes a time window — e.g. last_30d, daily_active. */
const TIME_BOUNDING_RE = /last_|_\d+d|_7d|_30d|_90d|daily|weekly|monthly/i;

function isTimeBounding(name: string): boolean {
  return TIME_BOUNDING_RE.test(name);
}

interface Props {
  /** Model segments exposed by /meta for the primary cube + joined cubes. */
  modelSegments: ModelSegmentEntry[];
  /** Currently active cube-segment sidecar (the saved set). */
  activeSegments: string[];
  /** Primary cube of the segment — determines which chips are editable. */
  primaryCube: string;
  /** Whether the viewer may toggle chips (owner or admin). */
  canAdminister: boolean;
  onChange: (next: string[]) => void;
}

export function CubeSegmentScopeChips({
  modelSegments,
  activeSegments,
  primaryCube,
  canAdminister,
  onChange,
}: Props): ReactElement | null {
  if (modelSegments.length === 0 && activeSegments.length === 0) return null;

  const activeSet = new Set(activeSegments);

  // Partition: primary-cube chips are toggleable; others are read-only cross-cube entries.
  const primaryChips = modelSegments.filter((s) => s.cube === primaryCube);
  const crossCubeActive = activeSegments.filter((name) => {
    const entry = modelSegments.find((s) => s.name === name);
    return !entry || entry.cube !== primaryCube;
  });

  const handleToggle = (name: string, currentlyActive: boolean) => {
    if (!canAdminister) return;

    if (currentlyActive) {
      // Removing: check if this is the last time-bounding segment.
      const remainingTimeBounding = activeSegments
        .filter((s) => s !== name && isTimeBounding(s));
      const isLastTimeBounding = isTimeBounding(name) && remainingTimeBounding.length === 0;

      if (isLastTimeBounding) {
        Modal.confirm({
          title: 'Remove time-bounding scope?',
          content:
            'This is the last date-scoped segment in the active set. Removing it may greatly widen membership (unbounded time scan) until the next refresh. Continue?',
          okText: 'Remove anyway',
          okButtonProps: { danger: true },
          cancelText: 'Keep it',
          onOk: () => {
            // Always preserve cross-cube entries.
            onChange([...crossCubeActive, ...activeSegments.filter((s) => s !== name && primaryChips.some((c) => c.name === s))]);
          },
        });
        return;
      }

      // Normal remove: keep all except this one, always keep cross-cube.
      onChange([
        ...crossCubeActive,
        ...activeSegments.filter((s) => s !== name && primaryChips.some((c) => c.name === s)),
      ]);
    } else {
      // Activating: add to current set, always keep cross-cube.
      onChange([
        ...crossCubeActive,
        ...activeSegments.filter((s) => primaryChips.some((c) => c.name === s)),
        name,
      ]);
    }
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 6,
        }}
      >
        Cube segments
      </div>
      <div className={styles.sliceScopeChips}>
        {primaryChips.map((seg) => {
          const active = activeSet.has(seg.name);
          return (
            <PrimaryChip
              key={seg.name}
              name={seg.name}
              title={seg.title}
              active={active}
              canAdminister={canAdminister}
              onToggle={() => handleToggle(seg.name, active)}
            />
          );
        })}

        {crossCubeActive.map((name) => {
          const entry = modelSegments.find((s) => s.name === name);
          const label = entry ? entry.title : name.split('.').pop() ?? name;
          const cubeName = name.split('.')[0] ?? name;
          return (
            <Tooltip
              key={name}
              title={`From cube: ${cubeName} — read-only sidecar (always preserved)`}
            >
              <span
                className={styles.sliceScopeChip}
                style={{
                  background: 'var(--info-soft)',
                  borderColor: 'var(--info-ink)',
                  color: 'var(--info-ink)',
                  cursor: 'default',
                }}
              >
                <LockOutlined style={{ marginRight: 4, fontSize: 10 }} />
                {label}
                <span style={{ marginLeft: 4, opacity: 0.65, fontSize: 10 }}>({cubeName})</span>
              </span>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

interface PrimaryChipProps {
  name: string;
  title: string;
  active: boolean;
  canAdminister: boolean;
  onToggle: () => void;
}

function PrimaryChip({ name, title, active, canAdminister, onToggle }: PrimaryChipProps): ReactElement {
  const chip = (
    <Button
      size="small"
      type={active ? 'primary' : 'default'}
      icon={active ? <CheckOutlined /> : undefined}
      onClick={canAdminister ? onToggle : undefined}
      disabled={!canAdminister}
      style={{
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 11,
        borderRadius: 999,
        height: 'auto',
        padding: '2px 10px',
        cursor: canAdminister ? 'pointer' : 'default',
        // Dim disabled chips slightly less than antd default so labels stay readable.
        opacity: canAdminister ? 1 : 0.6,
      }}
    >
      {title || name.split('.').pop()}
    </Button>
  );

  if (!canAdminister) {
    return (
      <Tooltip title="Only the segment owner or an admin can change cube segment scope">
        {chip}
      </Tooltip>
    );
  }

  return chip;
}
