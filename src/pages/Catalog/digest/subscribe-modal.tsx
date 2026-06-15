/**
 * SubscribeModal — opened from MetricDetailHeader right-rail. Lets the user
 * stash a {metricId, cadence, channel} preference in localStorage. v1 is
 * preview-only — no real Slack / email delivery — and the DigestPage
 * renders the canned templates from these records.
 */

import { useState } from 'react';
import styled from 'styled-components';

import type { BusinessMetric } from '../metrics-tab/business-metric-types';
import {
  type Cadence,
  type Channel,
  useSubscriptions,
} from '../../../shared/user-prefs/use-subscriptions';

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(15, 15, 15, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9000;
`;

const Modal = styled.div`
  width: min(420px, 92vw);
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 12px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.15);
  padding: 18px 20px;
`;

const Title = styled.h3`
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
`;

const Sub = styled.p`
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--text-muted);
`;

const Row = styled.div`
  display: flex;
  gap: 12px;
  margin: 8px 0;
  font-size: 12px;
`;

const Label = styled.label`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--border-card);
  border-radius: 6px;
  cursor: pointer;

  input { cursor: pointer; }
`;

const Actions = styled.div`
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

const Btn = styled.button<{ $primary?: boolean }>`
  height: 32px;
  padding: 0 12px;
  border: 1px solid
    ${(p) => (p.$primary ? 'var(--brand)' : 'var(--border-card)')};
  background: ${(p) => (p.$primary ? 'var(--brand)' : 'transparent')};
  color: ${(p) => (p.$primary ? 'white' : 'var(--text-primary)')};
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
`;

interface SubscribeModalProps {
  metric: BusinessMetric;
  onClose: () => void;
}

const CADENCES: Cadence[] = ['daily', 'weekly', 'on-anomaly'];
const CHANNELS: Channel[] = ['slack', 'email'];

export function SubscribeModal({ metric, onClose }: SubscribeModalProps) {
  const { upsert } = useSubscriptions();
  const [cadence, setCadence] = useState<Cadence>('weekly');
  const [channel, setChannel] = useState<Channel>('slack');

  const handleConfirm = () => {
    upsert({
      metricId: metric.id,
      cadence,
      channel,
      createdAt: new Date().toISOString(),
    });
    onClose();
  };

  return (
    <Backdrop
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Subscribe to metric digest"
    >
      <Modal onMouseDown={(e) => e.stopPropagation()}>
        <Title>Subscribe to {metric.label}</Title>
        <Sub>Preview-only · digests render in /catalog/digest</Sub>
        <Row>
          {CADENCES.map((c) => (
            <Label key={c}>
              <input
                type="radio"
                name="cadence"
                value={c}
                checked={cadence === c}
                onChange={() => setCadence(c)}
              />
              {c}
            </Label>
          ))}
        </Row>
        <Row>
          {CHANNELS.map((c) => (
            <Label key={c}>
              <input
                type="radio"
                name="channel"
                value={c}
                checked={channel === c}
                onChange={() => setChannel(c)}
              />
              {c}
            </Label>
          ))}
        </Row>
        <Actions>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn $primary onClick={handleConfirm}>
            Save subscription
          </Btn>
        </Actions>
      </Modal>
    </Backdrop>
  );
}
