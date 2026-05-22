/**
 * Reusable destructive-action confirmation modal with type-to-confirm.
 *
 * Used by segment delete (list + detail). The OK button stays disabled until
 * the user types the exact `expectedText` (segment name), so accidental
 * single-click destruction is not possible.
 */

import { ReactElement, ReactNode, useEffect, useState } from 'react';
import { Input, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import styles from '../segments.module.css';

interface Props {
  open: boolean;
  title: string;
  /** Body description above the input. */
  body: ReactNode;
  /** User must type this exactly to enable OK. */
  expectedText: string;
  /** Label for the destructive OK button. */
  okText: string;
  /** Called on confirmed OK; may be async. */
  onConfirm: () => Promise<void> | void;
  /** Called when modal is closed without confirming. */
  onCancel: () => void;
}

export function ConfirmDestructiveModal({
  open,
  title,
  body,
  expectedText,
  okText,
  onConfirm,
  onCancel,
}: Props): ReactElement {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset state every time the modal reopens — guards against stale input.
  useEffect(() => {
    if (open) {
      setTyped('');
      setSubmitting(false);
    }
  }, [open]);

  const match = typed.trim() === expectedText.trim() && expectedText.length > 0;

  return (
    <Modal
      visible={open}
      title={title}
      okText={okText}
      okType="danger"
      okButtonProps={{ disabled: !match || submitting, loading: submitting }}
      cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
      onOk={async () => {
        if (!match) return;
        setSubmitting(true);
        try {
          await onConfirm();
        } finally {
          setSubmitting(false);
        }
      }}
      onCancel={() => {
        if (submitting) return;
        onCancel();
      }}
      maskClosable={!submitting}
      destroyOnClose
    >
      <div className={styles.destructiveBody}>{body}</div>
      <div className={styles.destructivePromptLabel}>
        {t('segments.actions.delete.typePrompt', {
          defaultValue: 'Type {{name}} to confirm.',
          name: expectedText,
        })}
      </div>
      <Input
        autoFocus
        value={typed}
        placeholder={expectedText}
        onChange={(e) => setTyped(e.target.value)}
        disabled={submitting}
        className={typed.length > 0 && !match ? styles.destructiveInputError : undefined}
      />
    </Modal>
  );
}
