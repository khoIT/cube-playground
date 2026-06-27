/**
 * "Monitor consumption" job of the Pull API tab (admin-gated by the caller —
 * consumption + tokens endpoints are admin-only). For a served segment: the
 * snapshot schedule, an edit-guard note, the entitled-tokens list, and the
 * consumption observability view (summary + daily-by-key chart + outcome health
 * + pull log). Contract status/publish/demote live in the header above.
 */

import { ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Segment } from '../../../../../types/segment-api';
import { SnapshotScheduleCards } from '../serving/snapshot-schedule-cards';
import { SegmentTokensTable } from '../serving/segment-tokens-table';
import { ConsumptionView } from '../serving/consumption/consumption-view';

export function MonitorModeView({ segment }: { segment: Segment }): ReactElement {
  const lifecycle = segment.lifecycle ?? 'draft';
  const serving = segment.serving ?? null;

  return (
    <div>
      {lifecycle === 'draft' && (
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            background: 'var(--muted-soft)',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '12px 14px',
            marginBottom: 16,
            fontSize: 12.5,
            lineHeight: 1.45,
            color: 'var(--muted-ink)',
          }}
        >
          <AlertTriangle size={14} aria-hidden style={{ marginTop: 1, flex: 'none' }} />
          <span>
            Not published yet — this segment is in Exploration. Publish it for downstream serving (header above) to put it
            on a schedule. Any historical pulls still appear below.
          </span>
        </div>
      )}

      {/* Schedule (served/deprecated only — draft has no contract). */}
      {serving && <SnapshotScheduleCards serving={serving} />}

      {/* Edit-guard note — operators manage the contract here. */}
      {lifecycle === 'served' && (
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            background: 'var(--warning-soft)',
            color: 'var(--warning-ink)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            marginBottom: 16,
            fontSize: 12.5,
            lineHeight: 1.45,
          }}
        >
          <AlertTriangle size={14} aria-hidden style={{ marginTop: 1, flex: 'none' }} />
          <span>
            Downstream apps depend on this. Edits apply on the next snapshot; renaming or deleting it breaks their
            integration. Demote first (header above) if you need to retire it.
          </span>
        </div>
      )}

      <SegmentTokensTable segmentId={segment.id} />

      {/* Admin-only consumption observability (hides itself on 403). */}
      <ConsumptionView segmentId={segment.id} />
    </div>
  );
}
