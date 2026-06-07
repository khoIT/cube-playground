/**
 * SharedPill — tiny "Shared" chip rendered as a SidebarItem `trailing`
 * accessory on nav rows that belong to ANOTHER team member (segments and
 * chat sessions shared with the viewer). Always visible (not hover-only);
 * the owner attribution lives in the title tooltip to keep rows compact.
 */
import { useTranslation } from 'react-i18next';

export function SharedPill({ ownerLabel }: { ownerLabel?: string | null }) {
  const { t } = useTranslation();
  return (
    <span
      title={
        ownerLabel
          ? t('nav.sharedBy', { defaultValue: 'Shared by {{owner}}', owner: ownerLabel })
          : undefined
      }
      style={{
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 6px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--info-soft)',
        color: 'var(--info-ink)',
        fontFamily: 'var(--font-sans)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        userSelect: 'none',
      }}
    >
      {t('nav.sharedPill', { defaultValue: 'Shared' })}
    </span>
  );
}
