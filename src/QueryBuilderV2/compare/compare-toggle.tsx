/**
 * CompareToggle — segmented control: Off / Prev period / Other game.
 *
 * When "Other game" is selected a compact inline "vs <game>" picker appears to
 * choose the target game (excludes the currently active game).
 *
 * Styled to match the right-pane seg pattern (mirrors chart-type-toggle) using
 * design tokens — mounted at the top of the right-pane Compare tab.
 *
 * Props are intentionally minimal — no context coupling so the component stays
 * testable and reusable.
 */

import styled from 'styled-components';

import { useGameContext } from '../../components/Header/use-game-context';
import type { CompareMode } from './derive-compare-query';
import type { CompareSetting } from './compare-url-codec';

// ---------------------------------------------------------------------------
// Styled
// ---------------------------------------------------------------------------

const Row = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
`;

const Group = styled.div`
  display: inline-flex;
  padding: 1px;
  border-radius: 7px;
  background: var(--bg-muted);
  gap: 1px;
`;

const Segment = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 5px 11px;
  border: 0;
  border-radius: 6px;
  background: ${(p) => (p.$active ? 'var(--brand)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--text-on-brand)' : 'var(--text-secondary)')};
  font-family: var(--font-sans);
  font-weight: 500;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
  white-space: nowrap;

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  &:not(:disabled):hover {
    background: ${(p) => (p.$active ? 'var(--brand)' : 'var(--border-card)')};
    color: ${(p) => (p.$active ? 'var(--text-on-brand)' : 'var(--text-primary)')};
  }
`;

const VsLabel = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
`;

const GamePicker = styled.select`
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  cursor: pointer;
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompareToggleProps {
  value: CompareSetting;
  onChange: (value: CompareSetting) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CompareToggle({ value, onChange }: CompareToggleProps) {
  const { gameId: activeGameId, games } = useGameContext();

  // Other games (exclude active).
  const otherGames = games.filter((g) => g.id !== activeGameId);

  // Derive the active segment and the selected game for the picker.
  let segment: 'off' | 'prev' | 'game' = 'off';
  let selectedGameId: string = otherGames[0]?.id ?? '';

  if (value === 'prev') {
    segment = 'prev';
  } else if (value?.startsWith('game:')) {
    segment = 'game';
    selectedGameId = value.slice(5);
  }

  function handleSegment(next: 'off' | 'prev' | 'game') {
    if (next === 'off') {
      onChange(null);
    } else if (next === 'prev') {
      onChange('prev');
    } else {
      const gid = selectedGameId || otherGames[0]?.id;
      onChange(gid ? (`game:${gid}` as CompareMode) : null);
    }
  }

  function handleGameSelect(gid: string) {
    onChange(`game:${gid}` as CompareMode);
  }

  return (
    <Row>
      <Group role="tablist" aria-label="Compare mode">
        <Segment
          type="button"
          role="tab"
          aria-selected={segment === 'off'}
          $active={segment === 'off'}
          onClick={() => handleSegment('off')}
        >
          Off
        </Segment>
        <Segment
          type="button"
          role="tab"
          aria-selected={segment === 'prev'}
          $active={segment === 'prev'}
          onClick={() => handleSegment('prev')}
        >
          Prev period
        </Segment>
        <Segment
          type="button"
          role="tab"
          aria-selected={segment === 'game'}
          $active={segment === 'game'}
          disabled={otherGames.length === 0}
          onClick={() => handleSegment('game')}
        >
          Other game
        </Segment>
      </Group>

      {segment === 'game' && otherGames.length > 0 && (
        <VsLabel>
          vs
          <GamePicker
            aria-label="Comparison game"
            value={selectedGameId}
            onChange={(e) => handleGameSelect(e.target.value)}
          >
            {otherGames.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </GamePicker>
        </VsLabel>
      )}
    </Row>
  );
}
