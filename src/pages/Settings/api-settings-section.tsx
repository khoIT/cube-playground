/**
 * Settings tab: API credentials. Relocated from the sidebar's "API Settings"
 * row — opens the same SecurityContext modal where a user can paste a Cube API
 * token for the playground. In prod tokens are minted server-side, so this is a
 * power-user / local-dev affordance; keeping it on a Settings tab keeps the left
 * rail clean while leaving the modal reachable.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';

import {
  SectionCard,
  SectionHead,
  SectionTitle,
  SectionHint,
  ResetButton,
} from './section-card';
import { useSecurityContext } from '../../hooks/security-context';

export function ApiSettingsSection(): ReactElement {
  const { t } = useTranslation();
  const security = useSecurityContext();

  return (
    <SectionCard>
      <SectionHead>
        <div>
          <SectionTitle>
            {t('settings.api.title', { defaultValue: 'API credentials' })}
          </SectionTitle>
          <SectionHint>
            {t('settings.api.hint', {
              defaultValue:
                'Paste a Cube API token for the playground. In production tokens are minted automatically — this is for local development and advanced debugging.',
            })}
          </SectionHint>
        </div>
        <ResetButton
          type="button"
          onClick={() => security.setIsModalOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <KeyRound size={14} strokeWidth={1.75} aria-hidden />
          {t('settings.api.open', { defaultValue: 'Open API credentials' })}
        </ResetButton>
      </SectionHead>
    </SectionCard>
  );
}

export default ApiSettingsSection;
