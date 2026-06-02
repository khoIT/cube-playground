import { SegmentGroup, SegmentButton } from '../components/segmented-control';

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
    <SegmentGroup role="tablist" aria-label="Analysis mode">
      {OPTIONS.map((option) => {
        const active = mode === option.value;
        return (
          <SegmentButton
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            $active={active}
            onClick={() => onChange(option.value)}
          >
            <span>{option.label}</span>
          </SegmentButton>
        );
      })}
    </SegmentGroup>
  );
}
