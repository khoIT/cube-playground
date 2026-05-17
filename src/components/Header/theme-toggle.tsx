import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styled, { css } from 'styled-components';

import { ThemeMode } from '../../theme/ThemeContext';
import { useTheme } from '../../theme/use-theme';

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
`;

const Label = styled.span`
  flex: 1;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
`;

const Group = styled.div`
  display: inline-flex;
  background: var(--bg-muted);
  border-radius: var(--radius-pill);
  padding: 2px;
`;

const Option = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  border-radius: var(--radius-pill);
  cursor: pointer;
  background: transparent;
  color: var(--text-secondary);
  transition: background-color 120ms ease, color 120ms ease;

  ${(p) =>
    p.$active &&
    css`
      background: var(--bg-card);
      color: var(--text-primary);
      box-shadow: var(--shadow-xs);
    `}
`;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  const options: { key: ThemeMode; label: string; icon: JSX.Element }[] = [
    {
      key: 'light',
      label: t('user.theme.light'),
      icon: <Sun size={12} strokeWidth={2.2} aria-hidden />,
    },
    {
      key: 'dark',
      label: t('user.theme.dark'),
      icon: <Moon size={12} strokeWidth={2.2} aria-hidden />,
    },
  ];

  return (
    <Row>
      <Label>{t('user.theme.label')}</Label>
      <Group role="group" aria-label={t('user.theme.label')}>
        {options.map((opt) => (
          <Option
            key={opt.key}
            type="button"
            $active={theme === opt.key}
            aria-pressed={theme === opt.key}
            onClick={() => setTheme(opt.key)}
          >
            {opt.icon}
            {opt.label}
          </Option>
        ))}
      </Group>
    </Row>
  );
}
