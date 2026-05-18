import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import styled from 'styled-components';

import { useTheme } from '../../theme/use-theme';

// Both themes currently use the same branded artwork. Swap either constant
// when a theme-specific variant is added (e.g. /brand-logo-dark.png).
const darkLogo = '/android-chrome-192x192.png';
const lightLogo = '/android-chrome-192x192.png';

const Wrap = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 12px;
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
  width: 36px;
  height: 36px;
  display: block;
`;

const BrandMark = styled.span`
  font-family: var(--font-sans);
  font-weight: 700;
  font-size: 22px;
  letter-spacing: -0.3px;
  color: var(--text-primary);
`;

const Divider = styled.span`
  width: 1px;
  height: 26px;
  background-color: var(--border-strong);
`;

const Badge = styled.span`
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 999px;
  background-color: var(--bg-muted);
  border: 1px solid var(--border-card);
  text-transform: none;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
`;

const BadgeVng = styled.span`
  color: var(--brand);
  font-weight: 800;
`;

const BadgeGames = styled.span`
  color: #000;
  font-weight: 800;
`;

const BadgeSuffix = styled.span`
  color: var(--text-secondary);
  font-weight: 500;
  margin-left: 4px;
`;

export function BrandBlock() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const suffix = t('brand.platformSuffix');
  const ariaLabel = `VNGGAMES ${suffix}`;

  return (
    <Wrap to="/build" aria-label={ariaLabel}>
      <Logo src={theme === 'dark' ? darkLogo : lightLogo} alt="" aria-hidden />
      <BrandMark>Cube</BrandMark>
      <Divider />
      <Badge>
        <BadgeVng>VNG</BadgeVng>
        <BadgeGames>GAMES</BadgeGames>
        <BadgeSuffix>{suffix}</BadgeSuffix>
      </Badge>
    </Wrap>
  );
}
