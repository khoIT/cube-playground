import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import styled from 'styled-components';

import darkLogo from '../../assets/brand/cube-logo-dark.png';
import lightLogo from '../../assets/brand/cube-logo-light.png';
import { useTheme } from '../../theme/use-theme';

const Wrap = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: var(--text-primary);
  margin-right: 12px;
  padding: 0 4px;

  &:hover,
  &:focus {
    color: var(--text-primary);
  }
`;

const Logo = styled.img`
  width: 24px;
  height: 24px;
  display: block;
`;

const BrandMark = styled.span`
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 16px;
  letter-spacing: -0.2px;
  color: var(--text-primary);
`;

const Divider = styled.span`
  width: 1px;
  height: 18px;
  background-color: var(--border-strong);
`;

const Badge = styled.span`
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 999px;
  background-color: var(--bg-muted);
  color: var(--text-secondary);
  border: 1px solid var(--border-card);
  text-transform: none;
  white-space: nowrap;
`;

export function BrandBlock() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const badge = t('brand.platform');

  return (
    <Wrap to="/build" aria-label={badge}>
      <Logo src={theme === 'dark' ? darkLogo : lightLogo} alt="" aria-hidden />
      <BrandMark>Cube</BrandMark>
      <Divider />
      <Badge>{badge}</Badge>
    </Wrap>
  );
}
