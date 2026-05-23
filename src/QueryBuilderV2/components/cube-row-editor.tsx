import { Popover } from 'antd';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import styled from 'styled-components';

import { useCubeAlias } from '../../hooks/use-cube-alias';

import { IconPicker, getLucideIcon } from './icon-picker';

const Trigger = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    background: var(--bg-muted);
    color: var(--text-primary);
  }
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 300px;
  padding: 16px 18px;
  font-family: var(--font-sans);
`;

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
`;

const TextInput = styled.input`
  height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-input);
  border: 1px solid var(--border-strong);
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-card);

  &:focus {
    outline: none;
    border-color: var(--brand);
    box-shadow: 0 0 0 2px rgba(240, 90, 34, 0.12);
  }
`;

const IconRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const IconPreview = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-card);
  background: var(--bg-muted);
  color: var(--text-primary);
`;

const Footer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
`;

const SmallButton = styled.button<{ $variant?: 'primary' | 'ghost' }>`
  height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--border-strong);
  background: ${(p) => (p.$variant === 'primary' ? 'var(--brand)' : 'var(--bg-card)')};
  color: ${(p) => (p.$variant === 'primary' ? 'var(--text-on-brand)' : 'var(--text-primary)')};
  border-color: ${(p) => (p.$variant === 'primary' ? 'var(--brand)' : 'var(--border-strong)')};

  &:hover {
    background: ${(p) =>
      p.$variant === 'primary' ? 'var(--brand-hover)' : 'var(--bg-muted)'};
    border-color: ${(p) =>
      p.$variant === 'primary' ? 'var(--brand-hover)' : 'var(--brand)'};
  }
`;

const ResetLink = styled.button`
  background: transparent;
  border: 0;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  text-decoration: underline;

  &:hover {
    color: var(--brand);
  }
`;

const Hint = styled.div`
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
`;

type CubeRowEditorProps = {
  name: string;
  defaultDisplayName?: string;
};

export function CubeRowEditor({ name, defaultDisplayName }: CubeRowEditorProps) {
  const { alias, update, reset } = useCubeAlias(name);
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(alias.displayName ?? '');
  const [iconName, setIconName] = useState(alias.icon ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);

  function handleOpenChange(next: boolean) {
    if (next) {
      setDisplayName(alias.displayName ?? '');
      setIconName(alias.icon ?? '');
      setPickerOpen(false);
    }
    setOpen(next);
  }

  function handleSave() {
    update({
      displayName: displayName.trim() || undefined,
      icon: iconName || undefined,
    });
    setOpen(false);
  }

  function handleReset() {
    reset();
    setDisplayName('');
    setIconName('');
    setOpen(false);
  }

  const IconPreviewCmp = getLucideIcon(iconName);

  const content = (
    <Body>
      <Field>
        Display name
        <TextInput
          value={displayName}
          placeholder={defaultDisplayName ?? name}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </Field>
      <Field>
        Icon
        <IconRow>
          <IconPreview>
            {IconPreviewCmp ? <IconPreviewCmp size={16} /> : <span>—</span>}
          </IconPreview>
          <SmallButton type="button" onClick={() => setPickerOpen((v) => !v)}>
            {pickerOpen ? 'Close picker' : 'Choose icon'}
          </SmallButton>
          {iconName && (
            <ResetLink type="button" onClick={() => setIconName('')}>
              clear icon
            </ResetLink>
          )}
        </IconRow>
        {pickerOpen && (
          <IconPicker
            value={iconName}
            onPick={(n) => {
              setIconName(n);
              setPickerOpen(false);
            }}
          />
        )}
      </Field>
      <Hint>Display only — model file is unchanged.</Hint>
      <Footer>
        <ResetLink type="button" onClick={handleReset}>
          Reset
        </ResetLink>
        <div style={{ display: 'flex', gap: 8 }}>
          <SmallButton type="button" onClick={() => setOpen(false)}>
            Cancel
          </SmallButton>
          <SmallButton type="button" $variant="primary" onClick={handleSave}>
            Save
          </SmallButton>
        </div>
      </Footer>
    </Body>
  );

  return (
    <Popover
      trigger="click"
      placement="rightTop"
      content={content}
      visible={open}
      onVisibleChange={handleOpenChange}
      overlayClassName="cube-row-editor-popover"
      destroyTooltipOnHide
    >
      <Trigger
        type="button"
        aria-label="Edit alias"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <Pencil size={13} strokeWidth={2} />
      </Trigger>
    </Popover>
  );
}
