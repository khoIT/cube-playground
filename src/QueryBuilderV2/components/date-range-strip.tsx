import { useMemo } from 'react';
import styled from 'styled-components';

import { useQueryBuilderContext } from '../context';

const Wrap = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border-card);
  font-family: var(--font-sans);
`;

const Label = styled.span`
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
`;

const Segmented = styled.div`
  display: inline-flex;
  background: var(--bg-muted);
  border-radius: var(--radius-pill);
  padding: 2px;
`;

const Segment = styled.button<{ $active: boolean }>`
  border: 0;
  background: ${(p) => (p.$active ? 'var(--bg-card)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--text-primary)' : 'var(--text-secondary)')};
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  height: 26px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  cursor: pointer;
  box-shadow: ${(p) => (p.$active ? 'var(--shadow-xs)' : 'none')};

  &:hover {
    color: var(--text-primary);
  }
`;

type Preset = {
  key: string;
  label: string;
  value?: string;
};

const PRESETS: Preset[] = [
  { key: '7d', label: 'Last 7 days', value: 'last 7 days' },
  { key: '14d', label: 'Last 14 days', value: 'last 14 days' },
  { key: '30d', label: 'Last 30 days', value: 'last 30 days' },
  { key: 'qtd', label: 'QTD', value: 'this quarter' },
  { key: 'custom', label: 'Custom' },
];

function matchPreset(currentRange: unknown): string | undefined {
  if (typeof currentRange !== 'string') return undefined;
  const match = PRESETS.find((p) => p.value && p.value === currentRange);
  return match?.key;
}

export function DateRangeStrip() {
  const { query, updateQuery } = useQueryBuilderContext();

  const timeDimensions = query.timeDimensions ?? [];

  const activeKey = useMemo(
    () => matchPreset(timeDimensions[0]?.dateRange),
    [timeDimensions],
  );

  function applyPreset(preset: Preset) {
    if (!preset.value) {
      // Custom: leave the existing per-timeDim popover to handle selection.
      return;
    }
    updateQuery((prev) => {
      const tds = prev.timeDimensions ?? [];
      if (tds.length === 0) return;
      return {
        timeDimensions: tds.map((td) => ({ ...td, dateRange: preset.value })),
      };
    });
  }

  if (timeDimensions.length === 0) {
    return null;
  }

  return (
    <Wrap>
      <Label>Date range</Label>
      <Segmented>
        {PRESETS.map((p) => (
          <Segment
            key={p.key}
            $active={activeKey === p.key}
            onClick={() => applyPreset(p)}
            type="button"
            title={p.label}
          >
            {p.key === 'qtd' || p.key === 'custom' ? p.label : p.label.replace('Last ', '')}
          </Segment>
        ))}
      </Segmented>
    </Wrap>
  );
}
