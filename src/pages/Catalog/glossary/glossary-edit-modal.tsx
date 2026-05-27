/**
 * Dialog shell for create/edit. Handles focus management (auto-focus first
 * field, restore focus on close), Esc-to-close, backdrop-click-to-close,
 * and the Save/Delete/Cancel footer. Delegates form rendering to
 * `glossary-edit-form.tsx`.
 */

import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { X as XIcon } from 'lucide-react';
import type { GlossaryTerm } from '../../../api/glossary-client';
import { GlossaryEditForm, type FormValues } from './glossary-edit-form';

interface Props {
  open: boolean;
  initial?: GlossaryTerm;
  onClose: () => void;
  onSave: (values: FormValues) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  saving: boolean;
  errorMessage: string | null;
}

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const Dialog = styled.div`
  background: var(--bg-app);
  color: var(--text-primary);
  border-radius: var(--radius-md, 6px);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
  width: min(720px, 92vw);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  /* overflow:hidden + min-height:0 force the flex children to live inside the
     92vh cap so the scrollable <Form> body actually gets a scroll context;
     without the clip some browsers let the form overflow instead of shrinking
     and the footer/lower fields fall off-screen with no scrollbar. */
  overflow: hidden;
  min-height: 0;
  border: 1px solid var(--border-card);
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-subtle);
`;

const Title = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  font-family: var(--font-sans);
`;

const CloseBtn = styled.button`
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: 3px;
  &:hover { color: var(--text-primary); background: var(--bg-muted); }
`;

const Footer = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
  padding: 12px 18px;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-subtle, transparent);
`;

const ErrorLine = styled.div`
  flex: 1;
  color: var(--text-danger, #c1372f);
  font-size: 12px;
  font-family: var(--font-sans);
`;

const Btn = styled.button<{ $variant?: 'primary' | 'ghost' | 'danger' }>`
  border: 1px solid
    ${(p) => (p.$variant === 'primary' ? 'var(--brand)' : 'var(--border-card)')};
  background: ${(p) => (p.$variant === 'primary' ? 'var(--brand)' : 'transparent')};
  color: ${(p) =>
    p.$variant === 'primary'
      ? 'var(--brand-on, white)'
      : p.$variant === 'danger'
        ? 'var(--text-danger, #c1372f)'
        : 'var(--text-primary)'};
  font-size: 13px;
  font-weight: 500;
  padding: 6px 14px;
  border-radius: var(--radius-pill, 999px);
  cursor: pointer;
  font-family: var(--font-sans);
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;

export function GlossaryEditModal({
  open,
  initial,
  onClose,
  onSave,
  onDelete,
  saving,
  errorMessage,
}: Props) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  // Focus management: remember which element opened the modal so we can
  // restore focus on close — critical for keyboard-only navigation.
  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    const t = setTimeout(() => {
      const firstField = dialogRef.current?.querySelector<HTMLElement>(
        'input, textarea, button',
      );
      firstField?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      (triggerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const isEdit = !!initial;
  const canDelete = isEdit && initial?.source === 'user' && !!onDelete;

  return (
    <Backdrop onMouseDown={onClose}>
      <Dialog
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="glossary-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Header>
          <Title id="glossary-modal-title">
            {isEdit
              ? t('glossary.modal.editTitle', { defaultValue: 'Edit term' })
              : t('glossary.modal.createTitle', { defaultValue: 'New term' })}
          </Title>
          <CloseBtn type="button" onClick={onClose} aria-label={t('common.close', { defaultValue: 'Close' })}>
            <XIcon size={16} aria-hidden />
          </CloseBtn>
        </Header>
        <GlossaryEditForm
          initial={initial}
          onSubmit={(values) => void onSave(values)}
          saving={saving}
          i18n={{
            label: t('glossary.fields.label', { defaultValue: 'Label (EN)' }),
            labelVi: t('glossary.fields.labelVi', { defaultValue: 'Nhãn (VI)' }),
            description: t('glossary.fields.description', { defaultValue: 'Description (EN)' }),
            descriptionVi: t('glossary.fields.descriptionVi', { defaultValue: 'Mô tả (VI)' }),
            primaryCatalogId: t('glossary.fields.primaryCatalogId', { defaultValue: 'Primary catalog id' }),
            category: t('glossary.fields.category', { defaultValue: 'Category' }),
            aliases: t('glossary.fields.aliases', { defaultValue: 'Aliases (EN)' }),
            aliasesVi: t('glossary.fields.aliasesVi', { defaultValue: 'Aliases (VI)' }),
            editorName: t('glossary.fields.editorName', { defaultValue: 'Editor name' }),
            statusDraft: t('glossary.status.draft', { defaultValue: 'Draft' }),
            statusOfficial: t('glossary.status.official', { defaultValue: 'Official' }),
            aliasPlaceholder: t('glossary.placeholders.alias', { defaultValue: 'Add alias…' }),
            aliasPlaceholderVi: t('glossary.placeholders.aliasVi', { defaultValue: 'Thêm bí danh…' }),
            viPlaceholder: t('glossary.placeholders.vi', { defaultValue: 'Bản dịch tiếng Việt' }),
            save: t('glossary.actions.save', { defaultValue: 'Save' }),
          }}
        />
        <Footer>
          {errorMessage ? <ErrorLine>{errorMessage}</ErrorLine> : null}
          {canDelete ? (
            <Btn
              type="button"
              $variant="danger"
              disabled={saving}
              onClick={() => {
                if (window.confirm(t('glossary.actions.confirmDelete', { defaultValue: 'Delete this term?' }))) {
                  void onDelete?.();
                }
              }}
            >
              {t('glossary.actions.delete', { defaultValue: 'Delete' })}
            </Btn>
          ) : null}
          <Btn type="button" onClick={onClose} disabled={saving}>
            {t('glossary.actions.cancel', { defaultValue: 'Cancel' })}
          </Btn>
          <Btn
            type="submit"
            form="glossary-edit-form"
            $variant="primary"
            disabled={saving}
          >
            {t('glossary.actions.save', { defaultValue: 'Save' })}
          </Btn>
        </Footer>
      </Dialog>
    </Backdrop>
  );
}
