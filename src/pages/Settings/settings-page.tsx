/**
 * Settings page. Currently hosts one section: "Game picker visibility" — lets
 * the user hide individual games from the header picker dropdown without
 * touching the underlying game registry. New sections live as siblings to
 * <SectionShell>.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useHistory } from 'react-router-dom';
import styled from 'styled-components';
import { ArrowLeft, Check } from 'lucide-react';

import { useGameContext } from '../../components/Header/use-game-context';
import { useVisibleGames } from './use-visible-games';

const Page = styled.div`
  max-width: 720px;
  margin: 32px auto;
  padding: 0 24px;
  font-family: var(--font-sans);
  color: var(--text-primary);
`;

const PageHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 24px;
`;

const BackButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;

  &:hover,
  &:focus-visible {
    color: var(--brand);
    border-color: var(--brand);
    background: var(--brand-soft);
  }
`;

const PageTitle = styled.h1`
  margin: 0;
  font-size: 22px;
  font-weight: 600;
`;

const SectionShell = styled.section`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-xs);
  padding: 20px 22px;
`;

const SectionHead = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
`;

const SectionTitle = styled.h2`
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 600;
`;

const SectionHint = styled.p`
  margin: 0;
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.4;
`;

const ResetButton = styled.button`
  align-self: flex-start;
  height: 28px;
  padding: 0 12px;
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;

  &:hover,
  &:focus-visible {
    color: var(--brand);
    border-color: var(--brand);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const GameList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const GameRow = styled.li`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: var(--radius-card);
  cursor: pointer;
  transition: background-color 120ms ease;

  &:hover {
    background: var(--bg-muted);
  }
`;

const RowCheckbox = styled.span<{ $checked: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid ${(p) => (p.$checked ? 'var(--brand)' : 'var(--border-strong)')};
  background: ${(p) => (p.$checked ? 'var(--brand)' : 'transparent')};
  color: var(--text-on-brand);
  transition: background-color 120ms ease, border-color 120ms ease;
`;

const RowMark = styled.span<{ $color?: string }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-pill);
  background: ${(p) => p.$color || 'var(--brand)'};
  color: var(--text-on-brand);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
`;

const RowMeta = styled.span`
  flex: 1;
  display: flex;
  flex-direction: column;
  line-height: 1.2;
`;

const RowName = styled.span`
  font-size: 13.5px;
  font-weight: 500;
`;

const RowId = styled.span`
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
`;

function initialsOf(name: string, fallback: string, mark?: string): string {
  if (mark) return mark;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function SettingsPage(): ReactElement {
  const { t } = useTranslation();
  const history = useHistory();
  const { games } = useGameContext();
  const { isVisible, toggle, showAll, hidden } = useVisibleGames();

  const goBack = () => {
    // Prefer history.goBack so the user lands where they came from; if the
    // settings page was opened by direct URL (no prior entry), fall back to
    // the index route instead of leaving the SPA.
    if (history.length > 1) history.goBack();
    else history.push('/');
  };

  return (
    <Page>
      <PageHead>
        <BackButton
          type="button"
          onClick={goBack}
          aria-label={t('settings.back', { defaultValue: 'Back' })}
        >
          <ArrowLeft size={16} strokeWidth={2} aria-hidden />
        </BackButton>
        <PageTitle>{t('settings.title', { defaultValue: 'Settings' })}</PageTitle>
      </PageHead>

      <SectionShell>
        <SectionHead>
          <div>
            <SectionTitle>
              {t('settings.gameVisibility.title', { defaultValue: 'Game picker visibility' })}
            </SectionTitle>
            <SectionHint>
              {t('settings.gameVisibility.hint', {
                defaultValue:
                  'Choose which games appear in the header picker. Hidden games stay accessible via direct URL — this only affects the dropdown.',
              })}
            </SectionHint>
          </div>
          <ResetButton type="button" onClick={showAll} disabled={hidden.size === 0}>
            {t('settings.gameVisibility.showAll', { defaultValue: 'Show all' })}
          </ResetButton>
        </SectionHead>

        <GameList role="group" aria-label={t('settings.gameVisibility.title', { defaultValue: 'Game picker visibility' })}>
          {games.map((g) => {
            const checked = isVisible(g.id);
            return (
              <GameRow
                key={g.id}
                role="checkbox"
                aria-checked={checked}
                tabIndex={0}
                onClick={() => toggle(g.id)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    toggle(g.id);
                  }
                }}
              >
                <RowCheckbox $checked={checked} aria-hidden>
                  {checked ? <Check size={12} strokeWidth={3} /> : null}
                </RowCheckbox>
                <RowMark $color={g.color}>{initialsOf(g.name, g.id, g.mark)}</RowMark>
                <RowMeta>
                  <RowName>{g.name}</RowName>
                  <RowId>{g.id}</RowId>
                </RowMeta>
              </GameRow>
            );
          })}
        </GameList>
      </SectionShell>
    </Page>
  );
}

export default SettingsPage;
