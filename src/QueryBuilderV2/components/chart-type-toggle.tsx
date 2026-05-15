import styled from 'styled-components';
import {
  AreaChartOutlined,
  BarChartOutlined,
  LineChartOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { ChartType } from '@cubejs-client/core';

type ToggleChartType = Extract<ChartType, 'line' | 'bar' | 'area' | 'table'>;

const SEGMENTS: { value: ToggleChartType; label: string; Icon: any }[] = [
  { value: 'line', label: 'Line', Icon: LineChartOutlined },
  { value: 'bar', label: 'Bar', Icon: BarChartOutlined },
  { value: 'area', label: 'Area', Icon: AreaChartOutlined },
  { value: 'table', label: 'Table', Icon: TableOutlined },
];

const Group = styled.div`
  display: inline-flex;
  padding: 1px;
  border-radius: 7px;
  background: var(--neutral-100);
  gap: 1px;
`;

const Segment = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 0;
  border-radius: 6px;
  background: ${(p) => (p.$active ? 'var(--brand)' : 'transparent')};
  color: ${(p) => (p.$active ? 'var(--text-on-brand)' : 'var(--text-secondary)')};
  font-family: var(--font-sans);
  font-weight: 500;
  font-size: 11px;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;

  &:hover {
    background: ${(p) => (p.$active ? 'var(--brand)' : 'var(--neutral-200)')};
    color: ${(p) => (p.$active ? 'var(--text-on-brand)' : 'var(--text-primary)')};
  }
`;

type Props = {
  value: ChartType | undefined;
  onChange: (value: ToggleChartType) => void;
};

export function ChartTypeToggle({ value, onChange }: Props) {
  return (
    <Group role="tablist" aria-label="Chart type">
      {SEGMENTS.map(({ value: v, label, Icon }) => {
        const active = value === v;
        return (
          <Segment
            key={v}
            type="button"
            role="tab"
            aria-selected={active}
            $active={active}
            onClick={() => onChange(v)}
          >
            <Icon style={{ fontSize: 12 }} />
            <span>{label}</span>
          </Segment>
        );
      })}
    </Group>
  );
}
