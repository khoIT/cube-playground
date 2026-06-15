/**
 * TrustControl — three-button group on the metric-detail header. Lets a
 * user promote a metric to certified, mark it draft, or deprecate it.
 * "Promote to certified" is disabled with a tooltip when the runnability
 * check fails — single source of truth with the Run-anyway warning.
 */

import { useState } from 'react';
import { message, Modal } from 'antd';
import styled from 'styled-components';

import type {
  BusinessMetric,
  BusinessMetricTrust,
} from '../metrics-tab/business-metric-types';
import { useMetricRunnability } from './use-metric-runnability';
import { useTrustControl, type TrustControlError } from './use-trust-control';

const Group = styled.div`
  display: inline-flex;
  gap: 6px;
  align-items: center;
  margin-left: auto;
`;

const Btn = styled.button<{ $active?: boolean }>`
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border-card);
  background: ${(p) => (p.$active ? '#fff7ed' : 'transparent')};
  color: ${(p) => (p.$active ? '#9a3412' : 'var(--text-primary)')};
  font-size: 11.5px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;

  &:hover:not(:disabled) { border-color: var(--brand); }
  &:disabled {
    cursor: not-allowed;
    color: var(--text-muted);
    border-style: dashed;
  }
`;

interface Action {
  trust: BusinessMetricTrust;
  label: string;
}

const ACTIONS: Action[] = [
  { trust: 'certified', label: 'Promote to certified' },
  { trust: 'draft', label: 'Mark draft' },
  { trust: 'deprecated', label: 'Mark deprecated' },
];

function describeError(err: TrustControlError): string {
  if (err.code === 'REFS_UNRESOLVED') {
    return `Refs unresolved: ${err.missingRefs.join(', ')}`;
  }
  if (err.code === 'GAME_UNKNOWN') {
    return 'No primary game set for this metric — cannot validate refs.';
  }
  return err.message || err.code;
}

export function TrustControl({ metric }: { metric: BusinessMetric }) {
  const runnability = useMetricRunnability(metric);
  const { submit, submitting } = useTrustControl();
  const [pending, setPending] = useState<BusinessMetricTrust | null>(null);

  async function handleClick(target: BusinessMetricTrust) {
    if (submitting) return;
    setPending(target);
    Modal.confirm({
      title: `${target === metric.trust ? 'Re-affirm' : 'Change trust to'} "${target}"`,
      content: `Update trust for "${metric.label}" to ${target}? This appends an audit-trail entry.`,
      okText: 'Confirm',
      onOk: async () => {
        const result = await submit(metric.id, target);
        setPending(null);
        if (result.ok === true) {
          message.success(`Trust updated to "${target}".`);
        } else {
          message.error(describeError(result.error));
        }
      },
      onCancel: () => setPending(null),
    });
  }

  return (
    <Group role="group" aria-label="Trust controls">
      {ACTIONS.map((action) => {
        const isCertifyAction = action.trust === 'certified';
        const disabledByRefs =
          isCertifyAction && runnability.status === 'broken';
        const title = disabledByRefs
          ? `Refs unresolved: ${runnability.missingRefs.join(', ')}`
          : action.label;
        return (
          <Btn
            key={action.trust}
            type="button"
            $active={metric.trust === action.trust}
            disabled={submitting || disabledByRefs}
            title={title}
            aria-busy={pending === action.trust && submitting ? 'true' : undefined}
            onClick={() => handleClick(action.trust)}
          >
            {action.label}
          </Btn>
        );
      })}
    </Group>
  );
}
