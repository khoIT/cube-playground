/**
 * Modal wrapper around `ActivateToCdpTab`. Launched from Detail's
 * `+ Activate to CDP` CTA. Pre-populates everything from the segment.
 */

import { ReactElement } from 'react';
import { Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { ActivateToCdpTab } from './tabs/activate-to-cdp-tab';
import type { Segment } from '../../../types/segment-api';

interface Props {
  open: boolean;
  segment: Segment | null;
  identityField: string | null;
  dimensionOptions?: string[];
  onClose: () => void;
  onActivated?: (updated: Segment) => void;
}

export function ActivateToCdpModal({
  open,
  segment,
  identityField,
  dimensionOptions,
  onClose,
  onActivated,
}: Props): ReactElement {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      title={t('segments.activate.modalTitle', { defaultValue: 'Activate to CDP' })}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      width={560}
    >
      {segment ? (
        <ActivateToCdpTab
          segment={segment}
          identityField={identityField}
          dimensionOptions={dimensionOptions}
          onClose={onClose}
          onActivated={onActivated}
        />
      ) : (
        <div style={{ padding: 16, color: 'var(--text-secondary)' }}>
          {t('segments.activate.loading', { defaultValue: 'Loading segment…' })}
        </div>
      )}
    </Modal>
  );
}
