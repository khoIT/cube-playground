/**
 * Activation-tab header section that turns the lifecycle flag into the operator's
 * serving contract. Branches on lifecycle:
 *   draft       → a "Publish for downstream" promotion card
 *   served      → contract banner + schedule cards + entitled-tokens list + Demote
 *   deprecated  → retired banner + Re-publish + tokens
 *
 * Publish/demote call the lifecycle endpoints and lift the updated segment up via
 * onSegmentChange so the whole detail view re-renders into the new state without a
 * reload. (The publish "modal" is antd Modal.confirm — no separate file.)
 */

import { ReactElement } from 'react';
import { Button, message, Modal } from 'antd';
import { Radio } from 'lucide-react';
import { segmentsClient } from '../../../../../api/segments-client';
import { SegmentApiError } from '../../../../../api/api-client';
import type { Segment } from '../../../../../types/segment-api';
import { ServingContractBanner } from './serving-contract-banner';
import { SnapshotScheduleCards } from './snapshot-schedule-cards';
import { SegmentTokensTable } from './segment-tokens-table';

interface Props {
  segment: Segment;
  onSegmentChange?: (s: Segment) => void;
}

export function ServingContractSection({ segment, onSegmentChange }: Props): ReactElement | null {
  const lifecycle = segment.lifecycle ?? 'draft';
  const serving = segment.serving ?? null;
  const canAdminister = segment.can_administer;

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

  // Draft → promotion card.
  if (lifecycle === 'draft') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          border: '1px dashed var(--border-card)',
          borderRadius: 'var(--radius-xl, 14px)',
          padding: '14px 18px',
          marginBottom: 16,
          background: 'var(--bg-card)',
        }}
      >
        <Radio size={18} aria-hidden style={{ color: 'var(--layer-segment, #725390)', flex: 'none' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>Serve this segment downstream</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            Publish it as a contract a LiveOps/CS app can pull by id on a schedule. It stays in Exploration until you do.
          </div>
        </div>
        {canAdminister ? (
          <Button type="primary" onClick={confirmPublish}>
            Publish for downstream
          </Button>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Ask an owner or admin to publish</span>
        )}
      </div>
    );
  }

  // Served / deprecated → contract surface.
  return (
    <div style={{ marginBottom: 4 }}>
      {serving && <ServingContractBanner serving={serving} deprecated={lifecycle === 'deprecated'} />}
      {serving && lifecycle === 'served' && <SnapshotScheduleCards serving={serving} />}
      <SegmentTokensTable segmentId={segment.id} />
      {canAdminister && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
          {lifecycle === 'deprecated' && (
            <Button type="primary" onClick={confirmPublish}>
              Re-publish
            </Button>
          )}
          {lifecycle === 'served' && <Button danger onClick={() => doDemote(false)}>Demote</Button>}
        </div>
      )}
    </div>
  );
}
