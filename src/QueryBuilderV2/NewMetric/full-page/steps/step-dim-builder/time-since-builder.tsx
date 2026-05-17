import { useMemo } from 'react';
import styled from 'styled-components';
import type { WizardCube } from '../../../hooks/use-new-metric-meta';
import type { DimBuilder } from '../../../types';

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 560px;
`;
const Row = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
`;
const Label = styled.span`
  font-weight: 600;
  color: var(--text-primary);
`;
const Hint = styled.span`
  font-size: 12px;
  color: var(--text-muted);
`;
const Select = styled.select`
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  font-family: var(--font-mono);
`;

export type TimeSinceBuilderState = Extract<DimBuilder, { kind: 'time-since' }>;

export type TimeSinceBuilderProps = {
  cube: WizardCube | null;
  value: TimeSinceBuilderState | undefined;
  onChange: (next: TimeSinceBuilderState) => void;
};

export function TimeSinceBuilder({ cube, value, onChange }: TimeSinceBuilderProps) {
  // Restrict to time-typed columns; falls back to the full dimension list if
  // the source cube has no obvious time column so the user can still pick.
  const timeColumns = useMemo(() => {
    const dims = cube?.dimensions ?? [];
    const timey = dims.filter((d) => {
      const t = (d.type ?? '').toLowerCase();
      return t === 'time' || t === 'date' || t === 'timestamp';
    });
    return (timey.length > 0 ? timey : dims).map((d) => ({
      leaf: d.name.includes('.') ? d.name.split('.').slice(-1)[0] : d.name,
      type: d.type ?? 'unknown',
    }));
  }, [cube]);

  const current: TimeSinceBuilderState = value ?? { kind: 'time-since', timeColumn: null, unit: 'day' };

  return (
    <Wrap>
      <Row>
        <Label>Time column</Label>
        <Hint>Pick a timestamp/date column. The dim emits <code>DATE_DIFF(unit, {'{CUBE}'}.&lt;col&gt;, CURRENT_DATE)</code>.</Hint>
        <Select
          value={current.timeColumn ?? ''}
          onChange={(e) => onChange({ ...current, timeColumn: e.target.value || null })}
        >
          <option value="">— pick column —</option>
          {timeColumns.map((c) => (
            <option key={c.leaf} value={c.leaf}>{c.leaf} ({c.type})</option>
          ))}
        </Select>
      </Row>

      <Row>
        <Label>Unit</Label>
        <Hint>Diff unit for <code>DATE_DIFF</code>. Day is the most common.</Hint>
        <Select
          value={current.unit}
          onChange={(e) => onChange({ ...current, unit: e.target.value as TimeSinceBuilderState['unit'] })}
        >
          <option value="day">day</option>
          <option value="hour">hour</option>
          <option value="month">month</option>
        </Select>
      </Row>
    </Wrap>
  );
}
