/**
 * Game-Context picker. Compact chip in the Header that surfaces the active
 * game and lets the user switch via an antd Dropdown. On switch fires a toast
 * and a custom event ('gds-cube:game-change') so downstream consumers can
 * invalidate caches / refetch.
 *
 * Dropdown is a plain styled list (not antd Menu) because antd's Menu nests
 * its own border-radius inside the Dropdown's overlay, producing a lop-sided
 * rounded bleed at the bottom corners. The shell now owns the only radius
 * and clips children with overflow:hidden, so the active row's brand-tint
 * follows the shell curvature naturally.
 */

import { Dropdown, message } from 'antd';
import { ChevronDown, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';

import { useGameContext } from './use-game-context';
import { useVisibleGames } from '../../pages/Settings/use-visible-games';
import type { GameDef } from '../../types/segment-api';

const Chip = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 10px;
  background: var(--hermes-panel);
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

const Mark = styled.span<{ $color?: string; $size?: number }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: ${(p) => p.$size ?? 18}px;
  height: ${(p) => p.$size ?? 18}px;
  border-radius: var(--radius-pill);
  background: ${(p) => p.$color || 'var(--brand)'};
  color: var(--text-on-brand);
  font-size: ${(p) => ((p.$size ?? 18) >= 22 ? 10 : 9.5)}px;
  font-weight: 700;
  letter-spacing: 0.04em;
  font-family: var(--font-alt, var(--font-sans));
  flex-shrink: 0;
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

// Dropdown shell. Single radius lives here; overflow:hidden clips the active
// row's full-bleed tint so it follows the shell curvature.
const Shell = styled.div`
  width: 268px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-md);
  padding: 4px 0;
  overflow: hidden;
  font-family: var(--font-sans);
`;

const Row = styled.button<{ $active: boolean }>`
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: ${(p) => (p.$active ? 'var(--brand-soft)' : 'transparent')};
  border: none;
  text-align: left;
  cursor: pointer;
  transition: background 100ms ease;

  &:hover {
    background: ${(p) =>
      p.$active ? 'var(--brand-soft)' : 'var(--bg-muted)'};
  }
  &:focus-visible {
    outline: none;
    background: ${(p) =>
      p.$active ? 'var(--brand-soft)' : 'var(--bg-muted)'};
  }
`;

const RowMeta = styled.span`
  flex: 1;
  display: inline-flex;
  flex-direction: column;
  line-height: 1.2;
  min-width: 0;
`;

const RowName = styled.span<{ $active: boolean }>`
  font-size: 13.5px;
  font-weight: ${(p) => (p.$active ? 600 : 500)};
  color: ${(p) => (p.$active ? 'var(--brand)' : 'var(--text-primary)')};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const RowId = styled.span<{ $active: boolean }>`
  margin-top: 1px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: ${(p) => (p.$active ? 'var(--brand)' : 'var(--text-muted)')};
  opacity: ${(p) => (p.$active ? 0.75 : 1)};
`;

const CheckSlot = styled.span`
  // fixed-width slot so right edges stay aligned across rows
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
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
  const { isVisible } = useVisibleGames();
  const active = games.find((g) => g.id === gameId) || games[0];
  if (!active) return null;

  // Dropdown shows only user-allowed games. The active chip is always rendered
  // — hiding the current game in Settings shouldn't make the picker disappear.
  // We keep the active id in the visible list so the user can switch away from
  // it without first un-hiding it in Settings.
  const menuGames = games.filter((g) => isVisible(g.id) || g.id === gameId);

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
    <Shell role="menu" aria-label={t('header.gamePicker.label', { defaultValue: 'Active game' })}>
      {menuGames.map((g) => {
        const isActive = g.id === gameId;
        return (
          <Row
            key={g.id}
            type="button"
            role="menuitemradio"
            aria-checked={isActive}
            $active={isActive}
            onClick={() => onSelect(g.id)}
          >
            <Mark $color={g.color} $size={22}>
              {getInitials(g)}
            </Mark>
            <RowMeta>
              <RowName $active={isActive}>{g.name}</RowName>
              <RowId $active={isActive}>{g.id}</RowId>
            </RowMeta>
            <CheckSlot aria-hidden>{isActive ? <CheckMark /> : null}</CheckSlot>
          </Row>
        );
      })}
    </Shell>
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
