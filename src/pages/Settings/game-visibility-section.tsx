/**
 * Settings tab: game picker visibility. Lets the user hide individual games
 * from the header picker dropdown without touching the underlying game
 * registry. Hidden games stay accessible via direct URL — this only affects
 * the dropdown.
 */

import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { Check } from 'lucide-react';

import { useGameContext } from '../../components/Header/use-game-context';
import { useVisibleGames } from './use-visible-games';
import {
  SectionCard,
  SectionHead,
  SectionTitle,
  SectionHint,
  ResetButton,
} from './section-card';

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
  padding: 10px 12px;
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

export function GameVisibilitySection(): ReactElement {
  const { t } = useTranslation();
  const { games } = useGameContext();
  const { isVisible, toggle, showAll, hidden } = useVisibleGames();

  const title = t('settings.gameVisibility.title', {
    defaultValue: 'Game picker visibility',
  });

  return (
    <SectionCard>
      <SectionHead>
        <div>
          <SectionTitle>{title}</SectionTitle>
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

      <GameList role="group" aria-label={title}>
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
    </SectionCard>
  );
}

export default GameVisibilitySection;
