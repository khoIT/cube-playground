/**
 * Settings tab: identity map link-out. Pure navigation surface — the actual
 * mapping UI lives at /segments/identity-map.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { ChevronRight, Network } from 'lucide-react';

import {
  SectionCard,
  SectionHead,
  SectionTitle,
  SectionHint,
} from './section-card';

const LinkRow = styled(Link)`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-card);
  color: var(--text-primary);
  text-decoration: none;
  transition: background-color 120ms ease, border-color 120ms ease;

  &:hover,
  &:focus-visible {
    background: var(--bg-muted);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }
`;

const LinkRowBody = styled.span`
  flex: 1;
  display: flex;
  flex-direction: column;
  line-height: 1.3;
`;

const LinkRowTitle = styled.span`
  font-size: 13.5px;
  font-weight: 500;
`;

const LinkRowHint = styled.span`
  font-size: 12px;
  color: var(--text-muted);
`;

export function IdentityMapSection(): ReactElement {
  const { t } = useTranslation();

  return (
    <SectionCard>
      <SectionHead>
        <div>
          <SectionTitle>
            {t('settings.identityMap.title', { defaultValue: 'Identity Map' })}
          </SectionTitle>
          <SectionHint>
            {t('settings.identityMap.hint', {
              defaultValue:
                'Inspect the cube-to-identity mappings that bind segment members to product ids across cubes.',
            })}
          </SectionHint>
        </div>
      </SectionHead>
      <LinkRow to="/segments/identity-map">
        <Network size={18} strokeWidth={1.75} aria-hidden />
        <LinkRowBody>
          <LinkRowTitle>
            {t('settings.identityMap.openTitle', { defaultValue: 'Open Identity Map' })}
          </LinkRowTitle>
          <LinkRowHint>
            {t('settings.identityMap.openHint', {
              defaultValue: 'Cube → identity dim mapping, per-cube uid coverage',
            })}
          </LinkRowHint>
        </LinkRowBody>
        <ChevronRight size={16} aria-hidden />
      </LinkRow>
    </SectionCard>
  );
}

export default IdentityMapSection;
