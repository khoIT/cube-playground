/**
 * CompareToggle — 3-way toolbar control: Off / Prev period / Other game.
 *
 * When "Other game" is selected a compact inline dropdown appears to pick
 * the target game (excludes the currently active game).
 *
 * Mount location: inside the toolbar extras section next to PinToDashboardButton
 * in QueryBuilderInternals (same pattern as Phase 3's PinToDashboardButton).
 *
 * Props are intentionally minimal — no context coupling so the component stays
 * testable and reusable.
 */

import { Radio, Select } from 'antd';
import { useGameContext } from '../../components/Header/use-game-context';
import type { CompareMode } from './derive-compare-query';
import type { CompareSetting } from './compare-url-codec';

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

  // Derive the radio group value and the selected game for the dropdown.
  let radioValue: 'off' | 'prev' | 'game' = 'off';
  let selectedGameId: string = otherGames[0]?.id ?? '';

  if (value === 'prev') {
    radioValue = 'prev';
  } else if (value?.startsWith('game:')) {
    radioValue = 'game';
    selectedGameId = value.slice(5);
  }

  function handleRadioChange(next: 'off' | 'prev' | 'game') {
    if (next === 'off') {
      onChange(null);
    } else if (next === 'prev') {
      onChange('prev');
    } else {
      // 'game' — use current selectedGameId or fall back to first other game.
      const gid = selectedGameId || otherGames[0]?.id;
      onChange(gid ? (`game:${gid}` as CompareMode) : null);
    }
  }

  function handleGameSelect(gid: string) {
    selectedGameId = gid;
    onChange(`game:${gid}` as CompareMode);
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          fontSize: 12,
          color: 'var(--dark-05-color, #8c8c8c)',
          marginRight: 2,
          whiteSpace: 'nowrap',
        }}
      >
        Compare:
      </span>

      <Radio.Group
        value={radioValue}
        buttonStyle="solid"
        size="small"
        onChange={(e) => handleRadioChange(e.target.value as 'off' | 'prev' | 'game')}
      >
        <Radio.Button value="off">Off</Radio.Button>
        <Radio.Button value="prev">Prev period</Radio.Button>
        <Radio.Button value="game" disabled={otherGames.length === 0}>
          Other game
        </Radio.Button>
      </Radio.Group>

      {radioValue === 'game' && otherGames.length > 0 && (
        <Select
          size="small"
          value={selectedGameId}
          style={{ minWidth: 110 }}
          onChange={handleGameSelect}
          options={otherGames.map((g) => ({ value: g.id, label: g.name }))}
        />
      )}
    </span>
  );
}
