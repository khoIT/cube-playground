/**
 * Persistent contract header for the Pull API tab — one row, shown above both
 * jobs (Build / Monitor). Merges what used to be two redundant surfaces (the
 * serving-contract banner and the snapshot strip) into a single status line:
 * lifecycle pill + members + game + freshness + cohort filters, with the primary
 * lifecycle action on the right (Publish when draft, Demote when served,
 * Re-publish when deprecated). This is where Demote lives now — no longer a
 * floating button at the bottom of the page.
 */

import { ReactElement } from 'react';
import { Button, message, Modal } from 'antd';
import { segmentsClient } from '../../../../../api/segments-client';
import { SegmentApiError } from '../../../../../api/api-client';
import type { Segment, SegmentLifecycle } from '../../../../../types/segment-api';
import { relative } from '../serving/serving-format';
import { describePredicate } from '../../../slice-scope/describe-predicate';
import { parseCubeSegmentsFromQueryJson } from '../../../slice-scope/parse-cube-segments';

const ACCENT = 'var(--layer-segment, #725390)';

/** lifecycle → pill colors. served = segment-member violet; draft/deprecated muted. */
function pillStyle(lifecycle: SegmentLifecycle): React.CSSProperties {
  if (lifecycle === 'served') {
    return {
      background: `color-mix(in srgb, ${ACCENT} 12%, var(--bg-card))`,
      color: ACCENT,
    };
  }
  return { background: 'var(--muted-soft)', color: 'var(--muted-ink)' };
}

function pillLabel(lifecycle: SegmentLifecycle): string {
  if (lifecycle === 'served') return 'SERVED';
  if (lifecycle === 'deprecated') return 'RETIRED';
  return 'DRAFT';
}

export function PullContractHeader({
  segment,
  onSegmentChange,
}: {
  segment: Segment;
  onSegmentChange?: (s: Segment) => void;
}): ReactElement {
  const lifecycle: SegmentLifecycle = segment.lifecycle ?? 'draft';
  const canAdminister = segment.can_administer;
  const serving = segment.serving ?? null;

  // Cohort definition in plain language — cube-level segments lead, then chips.
  const cubeSegmentChips = parseCubeSegmentsFromQueryJson(segment.cube_query_json).map((s) => {
    const dot = s.indexOf('.');
    return `segment: ${dot >= 0 ? s.slice(dot + 1) : s}`;
  });
  const filterChips = [...cubeSegmentChips, ...describePredicate(segment.predicate_tree)];

  async function doPublish() {
    try {
      const updated = await segmentsClient.serve(segment.id);
      message.success(`Published “${segment.name}” for downstream serving`);
      onSegmentChange?.(updated);
    } catch (err) {
      message.error(err instanceof SegmentApiError ? err.message : 'Failed to publish segment');
    }
  }

  function confirmPublish() {
    Modal.confirm({
      title: 'Publish for downstream?',
      content:
        'Downstream apps will be able to pull this segment by id once snapshots land. Tracking is set to daily if it was off. You can demote it later.',
      okText: 'Publish',
      onOk: doPublish,
    });
  }

  async function doDemote(force = false) {
    try {
      const updated = await segmentsClient.demote(segment.id, force);
      message.success(`Demoted “${segment.name}” — no longer served downstream`);
      onSegmentChange?.(updated);
    } catch (err) {
      if (err instanceof SegmentApiError && err.status === 409 && err.code === 'HAS_CONSUMERS') {
        Modal.confirm({
          title: 'Force-demote a served segment?',
          content: `${serving?.entitledCount ?? 0} key(s) are entitled to pull this. Demoting blocks their pulls (403); it will be marked “Retired”.`,
          okText: 'Force demote',
          okButtonProps: { danger: true },
          onOk: () => doDemote(true),
        });
        return;
      }
      message.error(err instanceof SegmentApiError ? err.message : 'Failed to demote segment');
    }
  }

  // Right-side primary action varies by lifecycle.
  const action: ReactElement | null = !canAdminister
    ? lifecycle === 'draft'
      ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ask an owner or admin to publish</span>
      : null
    : lifecycle === 'draft'
      ? <Button type="primary" size="small" onClick={confirmPublish}>Publish for downstream</Button>
      : lifecycle === 'deprecated'
        ? <Button type="primary" size="small" onClick={confirmPublish}>Re-publish</Button>
        : <Button danger size="small" onClick={() => doDemote(false)}>Demote</Button>;

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-xl)',
          padding: '12px 18px',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: '0.03em',
            padding: '4px 11px',
            borderRadius: 'var(--radius-full)',
            ...pillStyle(lifecycle),
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} aria-hidden />
          {pillLabel(lifecycle)}
        </span>

        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
          <b style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
            {segment.uid_count.toLocaleString()}
          </b>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>members</span>
        </span>

        <span style={{ width: 1, height: 18, background: 'var(--border-strong)' }} aria-hidden />
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          game <b style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{segment.game_id}</b>
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>· computed {relative(segment.last_refreshed_at)}</span>

        {filterChips.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {filterChips.map((chip, i) => (
              <span
                key={`${chip}-${i}`}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-muted)',
                  border: '1px solid var(--border-card)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '3px 9px',
                }}
              >
                {chip}
              </span>
            ))}
          </div>
        )}

        {action && <span style={{ marginLeft: 'auto' }}>{action}</span>}
      </div>

      {/* Deprecated affects integrators too → a one-line warning under the row. */}
      {lifecycle === 'deprecated' && (
        <div
          style={{
            marginTop: 8,
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--warning-soft)',
            color: 'var(--warning-ink)',
            fontSize: 12.5,
            lineHeight: 1.45,
          }}
        >
          Demoted — downstream pulls are blocked (403). Re-publish to serve it again.
        </div>
      )}
    </div>
  );
}
