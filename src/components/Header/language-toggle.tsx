import { useTranslation } from 'react-i18next';
import styled, { css } from 'styled-components';

import { Lang } from '../../i18n';
import { useLang } from '../../i18n/use-lang';

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
  height: 24px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
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

export function LanguageToggle() {
  const { lang, setLang } = useLang();
  const { t } = useTranslation();

  const options: { key: Lang; label: string }[] = [
    { key: 'en', label: 'EN' },
    { key: 'vi', label: 'VI' },
  ];

  return (
    <Row>
      <Label>{t('user.language.label')}</Label>
      <Group role="group" aria-label={t('user.language.label')}>
        {options.map((opt) => (
          <Option
            key={opt.key}
            type="button"
            $active={lang === opt.key}
            aria-pressed={lang === opt.key}
            onClick={() => setLang(opt.key)}
          >
            {opt.label}
          </Option>
        ))}
      </Group>
    </Row>
  );
}
