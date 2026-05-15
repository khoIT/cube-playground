import { Radio } from 'antd';

export type AnalysisMode = 'breakdown' | 'distribution' | 'funnel';

interface ModePickerProps {
  mode: AnalysisMode;
  onChange: (mode: AnalysisMode) => void;
}

const OPTIONS: { value: AnalysisMode; label: string }[] = [
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'distribution', label: 'Distribution' },
  { value: 'funnel', label: 'Funnel' },
];

export function ModePicker({ mode, onChange }: ModePickerProps) {
  return (
    <Radio.Group
      value={mode}
      buttonStyle="solid"
      onChange={(e) => onChange(e.target.value as AnalysisMode)}
    >
      {OPTIONS.map((option) => (
        <Radio.Button key={option.value} value={option.value}>
          {option.label}
        </Radio.Button>
      ))}
    </Radio.Group>
  );
}
