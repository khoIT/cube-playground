import { Tooltip } from 'antd';
import { HelpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';

const IconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;

  &:hover,
  &:focus {
    background: var(--bg-muted);
    color: var(--text-primary);
  }
`;

export function HelpButton() {
  const { t } = useTranslation();
  const label = t('help.tooltip');

  return (
    <Tooltip title={label} placement="bottom">
      <IconButton type="button" aria-label={label}>
        <HelpCircle size={16} strokeWidth={2} />
      </IconButton>
    </Tooltip>
  );
}
