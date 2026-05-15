import { Button, Input, Select } from 'antd';
import { CloseOutlined, ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { Flow, Paragraph, tasty } from '@cube-dev/ui-kit';

interface CubeMember {
  name: string;
  type?: string;
}

interface FunnelInputsProps {
  eventDim: string | undefined;
  measure: string | undefined;
  steps: string[];
  eventDimOptions: CubeMember[];
  measureOptions: CubeMember[];
  onEventDimChange: (value: string | undefined) => void;
  onMeasureChange: (value: string | undefined) => void;
  onStepsChange: (steps: string[]) => void;
}

const StepRow = tasty({
  styles: {
    display: 'grid',
    gridColumns: 'min-content 1fr min-content min-content min-content',
    gap: '.5x',
    placeItems: 'center stretch',
  },
});

const PickerRow = tasty({
  styles: {
    display: 'grid',
    gridColumns: '1fr 1fr',
    gap: '1x',
  },
});

function shortName(name: string): string {
  const parts = name.split('.');
  return parts[parts.length - 1] || name;
}

function moveStep(steps: string[], index: number, direction: -1 | 1): string[] {
  const next = [...steps];
  const target = index + direction;

  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function FunnelInputs({
  eventDim,
  measure,
  steps,
  eventDimOptions,
  measureOptions,
  onEventDimChange,
  onMeasureChange,
  onStepsChange,
}: FunnelInputsProps) {
  return (
    <Flow gap="1x">
      <PickerRow>
        <Flow>
          <Paragraph preset="c1m">Event dimension</Paragraph>
          <Select
            showSearch
            placeholder="Pick the dimension that identifies events"
            style={{ width: '100%' }}
            value={eventDim}
            options={eventDimOptions.map((d) => ({ value: d.name, label: shortName(d.name) }))}
            onChange={(v) => onEventDimChange(v)}
          />
        </Flow>
        <Flow>
          <Paragraph preset="c1m">Primary measure</Paragraph>
          <Select
            showSearch
            placeholder="Pick a count or count_distinct measure"
            style={{ width: '100%' }}
            value={measure}
            options={measureOptions.map((m) => ({ value: m.name, label: shortName(m.name) }))}
            onChange={(v) => onMeasureChange(v)}
          />
        </Flow>
      </PickerRow>
      <Flow gap=".5x">
        <Paragraph preset="c1m">Steps (ordered)</Paragraph>
        {steps.map((step, idx) => (
          <StepRow key={idx}>
            <Paragraph preset="t3m">{idx + 1}.</Paragraph>
            <Input
              placeholder="event value (e.g. signup)"
              value={step}
              onChange={(e) => {
                const next = [...steps];
                next[idx] = e.target.value;
                onStepsChange(next);
              }}
            />
            <Button
              size="small"
              icon={<ArrowUpOutlined />}
              disabled={idx === 0}
              onClick={() => onStepsChange(moveStep(steps, idx, -1))}
            />
            <Button
              size="small"
              icon={<ArrowDownOutlined />}
              disabled={idx === steps.length - 1}
              onClick={() => onStepsChange(moveStep(steps, idx, 1))}
            />
            <Button
              size="small"
              icon={<CloseOutlined />}
              onClick={() => onStepsChange(steps.filter((_, i) => i !== idx))}
            />
          </StepRow>
        ))}
        <Button size="small" onClick={() => onStepsChange([...steps, ''])} style={{ width: 'max-content' }}>
          + Add step
        </Button>
      </Flow>
    </Flow>
  );
}
