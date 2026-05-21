/**
 * Game-Context picker. Compact chip in the Header that surfaces the active
 * game and lets the user switch via an antd Dropdown. On switch fires a toast
 * and a custom event ('gds-cube:game-change') so downstream consumers can
 * invalidate caches / refetch.
 */

import { Dropdown, Menu, message } from 'antd';
import { ChevronDown, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';

import { useGameContext } from './use-game-context';
import type { GameDef } from '../../types/segment-api';

const Chip = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease;

  &:hover,
  &:focus-visible {
    border-color: var(--brand);
    color: var(--brand);
  }
`;

const Mark = styled.span<{ $color?: string }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-pill);
  background: ${(p) => p.$color || 'var(--brand)'};
  color: var(--text-on-brand);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  font-family: var(--font-alt, var(--font-sans));
`;

const Name = styled.span`
  white-space: nowrap;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Chevron = styled(ChevronDown)`
  width: 14px;
  height: 14px;
  color: var(--text-muted);
`;

const MenuItemRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 200px;
  font-family: var(--font-sans);
`;

const MenuItemName = styled.span`
  flex: 1;
  display: inline-flex;
  flex-direction: column;
  line-height: 1.2;
`;

const MenuItemId = styled.span`
  color: var(--text-muted);
  font-size: 11px;
  font-family: var(--font-mono);
`;

const CheckMark = styled(Check)`
  width: 14px;
  height: 14px;
  color: var(--brand);
`;

function getInitials(game: GameDef): string {
  if (game.mark) return game.mark;
  const parts = game.name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return game.id.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function GamePicker() {
  const { t } = useTranslation();
  const { gameId, games, setGameId } = useGameContext();
  const active = games.find((g) => g.id === gameId) || games[0];
  if (!active) return null;

  const onSelect = (id: string) => {
    if (id === gameId) return;
    setGameId(id);
    const next = games.find((g) => g.id === id);
    if (next) {
      message.success(
        t('header.gamePicker.switchToast', {
          gameName: next.name,
          defaultValue: `Now showing data for ${next.name}`,
        }),
      );
    }
  };

  const overlay = (
    <Menu selectedKeys={[gameId]}>
      {games.map((g) => (
        <Menu.Item key={g.id} onClick={() => onSelect(g.id)}>
          <MenuItemRow>
            <Mark $color={g.color}>{getInitials(g)}</Mark>
            <MenuItemName>
              <span>{g.name}</span>
              <MenuItemId>{g.id}</MenuItemId>
            </MenuItemName>
            {g.id === gameId && <CheckMark />}
          </MenuItemRow>
        </Menu.Item>
      ))}
    </Menu>
  );

  return (
    <Dropdown overlay={overlay} trigger={['click']} placement="bottomLeft">
      <Chip
        type="button"
        aria-label={t('header.gamePicker.label', { defaultValue: 'Active game' })}
      >
        <Mark $color={active.color}>{getInitials(active)}</Mark>
        <Name>{active.name}</Name>
        <Chevron />
      </Chip>
    </Dropdown>
  );
}

export default GamePicker;
