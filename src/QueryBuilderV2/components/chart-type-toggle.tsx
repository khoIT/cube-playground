import styled from 'styled-components';
import {
  AreaChartOutlined,
  BarChartOutlined,
  LineChartOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { ChartType } from '@cubejs-client/core';

import { SegmentGroup, SegmentButton } from './segmented-control';

type ToggleChartType = Extract<ChartType, 'line' | 'bar' | 'area' | 'table'>;

/**
 * Make the toggle a query container so the segments can drop their labels when
 * the side pane is too narrow to fit four labeled segments + the action buttons.
 * Below the threshold the control degrades to icon-only (labels stay as the
 * accessible name); above it, full "Line/Bar/Area/Table" labels show.
 */
const Group = styled(SegmentGroup)`
  container-type: inline-size;
`;

const Segment = styled(SegmentButton)`
  @container (max-width: 248px) {
    /* Drop the label only; :not(.anticon) keeps the chart icon visible. */
    & > span:not(.anticon) {
      display: none;
    }
  }
`;

const SEGMENTS: { value: ToggleChartType; label: string; Icon: any }[] = [
  { value: 'line', label: 'Line', Icon: LineChartOutlined },
  { value: 'bar', label: 'Bar', Icon: BarChartOutlined },
  { value: 'area', label: 'Area', Icon: AreaChartOutlined },
  { value: 'table', label: 'Table', Icon: TableOutlined },
];

type Props = {
  value: ChartType | undefined;
  onChange: (value: ToggleChartType) => void;
};

export function ChartTypeToggle({ value, onChange }: Props) {
  return (
    <Group $fill role="tablist" aria-label="Chart type">
      {SEGMENTS.map(({ value: v, label, Icon }) => {
        const active = value === v;
        return (
          <Segment
            key={v}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={label}
            title={label}
            $active={active}
            $fill
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
